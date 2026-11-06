import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { before,beforeEach,after,test } from 'node:test';
import { initializeTestEnvironment,assertFails } from '@firebase/rules-unit-testing';
import { collection,deleteDoc,doc,getDocFromServer,getDocsFromServer,limit,query,serverTimestamp,setDoc,setLogLevel,Timestamp,writeBatch } from 'firebase/firestore';
const PLACE='i7jb-7jku:code-report-sdk',OTHER='i7jb-7jku:other-code-sdk',ID='WebV2CodeReport00001',ID2='WebV2CodeReport00002';
assert.equal(ID.length,20);assert.equal(ID2.length,20);
const OLD=Timestamp.fromDate(new Date('2020-01-01'));
const temp=await mkdtemp(join(tmpdir(),'rr-code-reports-sdk-'));
const moduleURL=async(name,source)=>{const path=join(temp,name+'.mjs');await writeFile(path,source);return pathToFileURL(path).href;};
const pureURL=await moduleURL('model',stripTypeScriptTypes(await readFile(new URL('../../lib/code-evidence-model.ts',import.meta.url),'utf8')));
const oldModelURL=await moduleURL('old-model',stripTypeScriptTypes(await readFile(new URL('../../lib/passcode-model.ts',import.meta.url),'utf8')));
const clientURL=await moduleURL('client','export const getFirebaseClient=()=>globalThis.__codeSDKClient;export const getFirebaseConfigurationError=()=>null;');
const authURL=await moduleURL('auth','export function onAuthStateChanged(auth,callback){globalThis.__codeSDKHooks.listeners.set(auth,callback);queueMicrotask(()=>callback(auth.currentUser));return()=>globalThis.__codeSDKHooks.listeners.delete(auth);}');
const fireURL=import.meta.resolve('firebase/firestore');
const wrapperURL=await moduleURL('firebase',`
 import * as real from ${JSON.stringify(fireURL)};export * from ${JSON.stringify(fireURL)};
 export const getFirestore=()=>globalThis.__codeSDKDatabase;
 export async function runTransaction(db,callback,options){
  const hooks=globalThis.__codeSDKHooks,mode=hooks.mode;hooks.mode=null;
  if(hooks.failReads>0){hooks.failReads--;throw {code:'unavailable'};}
  if(mode==='before-error')throw {code:'unavailable'};
  const result=await real.runTransaction(db,callback,options);
  if(mode==='after-error')throw {code:'unavailable'};
  if(mode==='readback-error')hooks.failReads=2;
  if(mode==='same-uid-replacement'||mode==='account-change'){
   const auth=globalThis.__codeSDKClient.auth;auth.currentUser={uid:mode==='same-uid-replacement'?'owner':'bob',isAnonymous:false};hooks.listeners.get(auth)?.(auth.currentUser);
  }
  return result;
 }
`);
const serviceURL=await moduleURL('service',stripTypeScriptTypes(await readFile(new URL('../../lib/code-reports.ts',import.meta.url),'utf8'))
 .replaceAll('"firebase/auth"',JSON.stringify(authURL)).replaceAll('"firebase/firestore"',JSON.stringify(wrapperURL))
 .replaceAll('"@/lib/firebase-client"',JSON.stringify(clientURL)).replaceAll('"@/lib/code-evidence-model"',JSON.stringify(pureURL)).replaceAll('"@/lib/passcode-model"',JSON.stringify(oldModelURL)));
const api=await import(serviceURL);
let env,owner,bob,reader,voters;
function client(db,uid='owner',anonymous=false){globalThis.__codeSDKDatabase=db._delegate??db;const result={app:db.app,auth:{currentUser:uid?{uid,isAnonymous:anonymous}:null}};globalThis.__codeSDKClient=result;return result;}
const pub=(db,id=ID,kind='v2',place=PLACE)=>doc(db,kind==='v2'?'restroomPasscodeReportsV2':'restroomPasscodeReports',place,'reports',id);
const sum=(db,id=ID,kind='v2',place=PLACE)=>doc(db,'restroomPasscodeFeedback',place,'codes',`${kind}_${id}`);
async function evidence(db=owner,uid='owner',check=state=>!state.publicLoading&&!state.ownLoading&&!state.feedbackLoading){
 client(db,uid);return new Promise((resolve,reject)=>{let stop=()=>{};const timer=setTimeout(()=>{stop();reject(new Error('Evidence watcher timeout'));},6000);stop=api.watchCodeEvidence(PLACE,uid,state=>{if(check(state)){clearTimeout(timer);stop();resolve(state);}});});
}
async function created(visibility='public',id=ID){client(owner);await api.reportNewCode('owner',PLACE,id,{code:id===ID?'0012#':'5656',visibility});return (await evidence()).records.find(r=>r.reportID===id);}
async function reportFor(db,uid,id=ID){return (await evidence(db,uid)).records.find(r=>r.reportID===id);}
const input=()=>({code:'0012#',visibility:'public'});
before(async()=>{
 setLogLevel('silent');const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8185'}`);assert.ok(['127.0.0.1','localhost'].includes(endpoint.hostname));
 env=await initializeTestEnvironment({projectId:'demo-restroom-code-reports-sdk',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
 const auth=uid=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'google.com'}}).firestore();owner=auth('owner');bob=auth('bob');voters=Array.from({length:4},(_,i)=>({uid:'visitor'+i,db:auth('visitor'+i)}));reader=env.unauthenticatedContext().firestore();
});
beforeEach(async()=>{
 globalThis.__codeSDKHooks={mode:null,failReads:0,listeners:new Map()};client(owner);await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const b=writeBatch(c.firestore());for(const p of [PLACE,OTHER])b.set(doc(c.firestore(),'restroomRatingSummaries',p),{ratingCount:0,ratingSum:0,updatedAt:OLD});await b.commit();});
});
after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}delete globalThis.__codeSDKHooks;delete globalThis.__codeSDKClient;delete globalThis.__codeSDKDatabase;await rm(temp,{recursive:true,force:true});});

test('actual API creates immutable public V2 pair and anonymous dual-source feed',async()=>{
 const row=await created();assert.equal(row.kind,'v2');assert.equal(row.ownership,'own');assert.equal(row.code,'0012#');assert.equal(row.usedCount,0);assert.equal(row.verifiedAt,null);
 const data=(await getDocFromServer(pub(reader))).data();assert.deepEqual(Object.keys(data).sort(),['code','codeUpdatedAt','placeID']);
 const own=(await getDocFromServer(doc(owner,'users','owner','restroomReadyPasscodesV2',ID))).data();assert.equal(own.createdAt.isEqual(data.codeUpdatedAt),true);
 assert.equal((await evidence(reader,null)).records[0].ownership,'other');await assertFails(getDocFromServer(doc(bob,'users','owner','restroomReadyPasscodesV2',ID)));
});
test('private default-shaped input stays private, automatically Saved and becomes owner-only public through paired visibility',async()=>{
 let row=await created('private');assert.equal((await evidence(reader,null)).records.length,0);assert.equal((await getDocFromServer(doc(owner,'users','owner','restroomReadySaved',PLACE))).exists(),true);
 client(owner);await api.verifyPrivateCode('owner',row);row=await reportFor(owner,'owner');assert.ok(row.verifiedAt);
 client(owner);await api.setCodeVisibility('owner',row,'public');row=await reportFor(owner,'owner');assert.equal(row.visibility,'public');assert.equal(row.verifiedAt,null);
 client(owner);await api.setCodeVisibility('owner',row,'private');assert.equal((await evidence(reader,null)).records.length,0);
});
test('stable draft retry and lost acknowledgement create one immutable report, changed draft rejected',async()=>{
 globalThis.__codeSDKHooks.mode='after-error';client(owner);await api.reportNewCode('owner',PLACE,ID,input());
 client(owner);await api.reportNewCode('owner',PLACE,ID,input());
 await assert.rejects(api.reportNewCode('owner',PLACE,ID,{...input(),code:'changed'}),/already saved/);
 assert.equal((await getDocsFromServer(query(collection(reader,'restroomPasscodeReportsV2',PLACE,'reports'),limit(10)))).size,1);
 await created('public',ID2);assert.equal((await evidence(reader,null)).records.length,2);
});
test('owner delete preserves other immutable versions and saved place; lost delete ack recovers',async()=>{
 const row=await created();await created('public',ID2);client(owner);globalThis.__codeSDKHooks.mode='after-error';await api.deleteCodeReport('owner',row);await api.deleteCodeReport('owner',row);
 const state=await evidence(reader,null);assert.deepEqual(state.records.map(r=>r.reportID),[ID2]);
});
test('Used/Invalid is exclusive per account, repeats refresh without count growth and invalid preserves last successful date',async()=>{
 await created();let row=await reportFor(bob,'bob');client(bob,'bob');await api.setCodeFeedback('bob',row,'used');const first=(await getDocFromServer(sum(reader))).data();
 row=await reportFor(bob,'bob');client(bob,'bob');await api.setCodeFeedback('bob',row,'used');const twice=(await getDocFromServer(sum(reader))).data();assert.equal(twice.usedCount,1);assert.equal(twice.invalidCount,0);assert.ok(twice.updatedAt.toMillis()>=first.updatedAt.toMillis());
 row=await reportFor(bob,'bob');client(bob,'bob');await api.setCodeFeedback('bob',row,'invalid');const invalid=(await getDocFromServer(sum(reader))).data();assert.equal(invalid.usedCount,0);assert.equal(invalid.invalidCount,1);assert.ok(invalid.lastUsedAt.isEqual(twice.lastUsedAt));
 await assert.rejects(api.setCodeFeedback('bob',{...row,ownership:'own'},'used'),/another visitor/);
});
test('four distinct API voters produce four current Used and owner cannot contribute',async()=>{
 const owned=await created();client(owner);await assert.rejects(api.setCodeFeedback('owner',{...owned,ownership:'other'},'used'),/could not be confirmed/);
 const reports=await Promise.all(voters.slice(0,3).map(v=>reportFor(v.db,v.uid))); // Three concurrent guarded attempts, then a fourth distinct visitor.
 const results=await Promise.allSettled(voters.slice(0,3).map((v,i)=>{client(v.db,v.uid);return api.setCodeFeedback(v.uid,reports[i],'used');}));
 assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.message),[]);
 const fourth=voters[3],fourthReport=await reportFor(fourth.db,fourth.uid);client(fourth.db,fourth.uid);await api.setCodeFeedback(fourth.uid,fourthReport,'used');
 const counts=(await getDocFromServer(sum(reader))).data();assert.equal(counts.usedCount,4);assert.equal(counts.invalidCount,0);
});
test('same-account concurrent checks and lost feedback acknowledgement count once',async()=>{
 await created();const row=await reportFor(bob,'bob');client(bob,'bob');globalThis.__codeSDKHooks.mode='after-error';await api.setCodeFeedback('bob',row,'used');
 const results=await Promise.allSettled([api.setCodeFeedback('bob',row,'used'),api.setCodeFeedback('bob',row,'used')]);assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.message),[]);assert.equal((await getDocFromServer(sum(reader))).data().usedCount,1);
});
test('stale legacy feedback resets on exact current version and old lastVerified date never seeds a count',async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(pub(c.firestore(),ID,'legacy'),{placeID:PLACE,code:'0909',codeUpdatedAt:OLD,lastVerifiedAt:OLD}));
 let row=await reportFor(bob,'bob');assert.equal(row.usedCount,0);assert.ok(row.verifiedAt);client(bob,'bob');await api.setCodeFeedback('bob',row,'used');
 const newer=Timestamp.fromMillis(Date.now()-1000);await env.withSecurityRulesDisabled(c=>setDoc(pub(c.firestore(),ID,'legacy'),{placeID:PLACE,code:'0909',codeUpdatedAt:newer,lastVerifiedAt:null}));
 client(bob,'bob');await assert.rejects(api.setCodeFeedback('bob',row,'used'),/changed/);
 row=await reportFor(bob,'bob');assert.equal(row.usedCount,null);assert.equal(row.verifiedAt,null);client(bob,'bob');await api.setCodeFeedback('bob',row,'invalid');const data=(await getDocFromServer(sum(reader,ID,'legacy'))).data();assert.equal(data.usedCount,0);assert.equal(data.invalidCount,1);assert.equal(data.lastUsedAt,null);
});
test('partial current vote with no summary fails closed and cannot reset somebody else totals',async()=>{
 await created();const row=await reportFor(bob,'bob');const version=(await getDocFromServer(pub(reader))).data().codeUpdatedAt;
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users','bob','restroomReadyPasscodeVotes',`${PLACE}~v2_${ID}`),{placeID:PLACE,kind:'v2',reportID:ID,codeUpdatedAt:version,vote:'used',updatedAt:version}));
 client(bob,'bob');await assert.rejects(api.setCodeFeedback('bob',row,'invalid'),/needs checking/);assert.equal((await getDocFromServer(sum(reader))).exists(),false);
});
test('same UID User replacement prevents success and immediately clears private watcher state',async()=>{
 const row=await created('private');const activeClient=client(owner);let latest;const stop=api.watchCodeEvidence(PLACE,'owner',state=>{latest=state;});await new Promise(resolve=>setTimeout(resolve,150));assert.ok(latest.records.some(r=>r.visibility==='private'));
 const auth=activeClient.auth;auth.currentUser={uid:'owner',isAnonymous:false};globalThis.__codeSDKHooks.listeners.get(auth)?.(auth.currentUser);assert.equal(latest.records.some(r=>r.visibility==='private'),false);stop();
 client(owner);globalThis.__codeSDKHooks.mode='same-uid-replacement';await assert.rejects(api.setCodeVisibility('owner',row,'public'),/account changed/);
});
test('account lock prevents new mutations, no broad authorization retry or old matching vote confirmation',async()=>{
 await created();let row=await reportFor(bob,'bob');client(bob,'bob');await api.setCodeFeedback('bob',row,'used');
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'accountDeletionLocks','bob'),{phase:'pending'}));
 client(bob,'bob');await assert.rejects(api.setCodeFeedback('bob',row,'used'),/could not be confirmed/);
 client(bob,'bob');await assert.rejects(api.reportNewCode('bob',PLACE,ID2,input()),/could not be confirmed/);assert.equal((await getDocFromServer(pub(reader,ID2))).exists(),false);
});
test('legacy own code can change only visibility and delete through strict account-owned pair',async()=>{
 await env.withSecurityRulesDisabled(async c=>{const b=writeBatch(c.firestore());b.set(doc(c.firestore(),'users','owner','restroomReadyPasscodes',PLACE),{placeID:PLACE,reportID:ID,code:'0909',visibility:'public',createdAt:OLD,codeUpdatedAt:OLD,lastVerifiedAt:null});b.set(doc(c.firestore(),'restroomPasscodeOwners',ID),{ownerUID:'owner',placeID:PLACE,createdAt:OLD});b.set(pub(c.firestore(),ID,'legacy'),{placeID:PLACE,code:'0909',codeUpdatedAt:OLD,lastVerifiedAt:null});await b.commit();});
 let row=await reportFor(owner,'owner');assert.equal(row.kind,'legacy');client(owner);await api.setCodeVisibility('owner',row,'private');row=await reportFor(owner,'owner');assert.equal(row.code,'0909');assert.equal(row.codeVersion,`${OLD.seconds}:0`);
 client(owner);await api.deleteCodeReport('owner',row);assert.equal((await evidence(reader,null)).records.length,0);
});

test('private stable replay and already-private visibility restore a removed Saved pair before confirming',async()=>{
 let row=await created('private');const saved=doc(owner,'users','owner','restroomReadySaved',PLACE);await deleteDoc(saved);
 client(owner);await api.reportNewCode('owner',PLACE,ID,{code:'0012#',visibility:'private'});assert.equal((await getDocFromServer(saved)).exists(),true);
 await deleteDoc(saved);row=await reportFor(owner,'owner');client(owner);await api.setCodeVisibility('owner',row,'private');assert.equal((await getDocFromServer(saved)).exists(),true);
});

test('failed coherent private Saved readback cannot confirm a save, and exact stable retry recovers',async()=>{
 client(owner);globalThis.__codeSDKHooks.mode='readback-error';await assert.rejects(api.reportNewCode('owner',PLACE,ID,{code:'0012#',visibility:'private'}),/could not be confirmed/);
 client(owner);await api.reportNewCode('owner',PLACE,ID,{code:'0012#',visibility:'private'});assert.equal((await getDocFromServer(doc(owner,'users','owner','restroomReadySaved',PLACE))).exists(),true);
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users','owner','restroomReadySaved',PLACE),{placeID:OTHER,savedAt:OLD}));
 client(owner);await assert.rejects(api.reportNewCode('owner',PLACE,ID,{code:'0012#',visibility:'private'}),/saved place/);
});
test('malformed public schema hides the affected feed and never substitutes its timestamps or ownership',async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(pub(c.firestore(),ID,'legacy'),{placeID:PLACE,code:'0909',codeUpdatedAt:OLD,lastVerifiedAt:null,unexpected:true}));
 const state=await evidence(reader,null,s=>!s.publicLoading);assert.equal(state.records.length,0);assert.match(state.publicError,/invalid/);
});
test('exact V2 ownership GET prevents an older public report outside own latest-ten from becoming other-owned',async()=>{
 await created();
 for(let i=0;i<11;i++){client(owner);await api.reportNewCode('owner',PLACE,('PrivateWebReport'+String(i).padStart(4,'0')),{code:'private',visibility:'private'});}
 const state=await evidence();const row=state.records.find(r=>r.reportID===ID);assert.equal(row.ownership,'own');assert.ok(row.createdVersion);client(owner);await assert.rejects(api.setCodeFeedback('owner',row,'used'),/another visitor/);
});

test('a submillisecond selected-version mismatch fails before any public feedback write',async()=>{
 await created();const row=await reportFor(bob,'bob');const [seconds,nanos]=row.codeVersion.split(':').map(Number);const different=nanos%1e6<999999?nanos+1:nanos-1;
 assert.equal(new Date(seconds*1000+different/1e6).getTime(),row.codeUpdatedAt.getTime());
 client(bob,'bob');await assert.rejects(api.setCodeFeedback('bob',{...row,codeVersion:`${seconds}:${different}`},'used'),/changed/);assert.equal((await getDocFromServer(sum(reader))).exists(),false);
});
test('failed repeated check cannot accept an old matching vote; same draft retry refreshes without a new voter',async()=>{
 await created();const row=await reportFor(bob,'bob');client(bob,'bob');await api.setCodeFeedback('bob',row,'used');const before=(await getDocFromServer(sum(reader))).data();
 globalThis.__codeSDKHooks.mode='before-error';await assert.rejects(api.setCodeFeedback('bob',row,'used'),/could not be confirmed/);assert.equal((await getDocFromServer(sum(reader))).data().updatedAt.isEqual(before.updatedAt),true);
 await api.setCodeFeedback('bob',row,'used');const after=(await getDocFromServer(sum(reader))).data();assert.equal(after.usedCount,1);assert.ok(!after.updatedAt.isEqual(before.updatedAt));
});
test('four simultaneous distinct checks keep failures bounded and explicit same-draft retries finish without double counting',async()=>{
 await created();const reports=await Promise.all(voters.map(v=>reportFor(v.db,v.uid)));
 const results=await Promise.allSettled(voters.map((v,i)=>{client(v.db,v.uid);return api.setCodeFeedback(v.uid,reports[i],'used');}));
 for(let i=0;i<results.length;i++)if(results[i].status==='rejected'){assert.match(results[i].reason.message,/could not be confirmed|changed repeatedly/);client(voters[i].db,voters[i].uid);await api.setCodeFeedback(voters[i].uid,reports[i],'used');}
 const data=(await getDocFromServer(sum(reader))).data();assert.equal(data.usedCount,4);assert.equal(data.invalidCount,0);
});
