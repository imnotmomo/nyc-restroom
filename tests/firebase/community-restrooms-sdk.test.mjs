import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocFromServer, getDocsFromServer, limit, query, setDoc, deleteDoc, setLogLevel, Timestamp } from 'firebase/firestore';
const ID='community-WebRequestFixture001';
const workspace=await mkdtemp(join(tmpdir(),'restroom-community-request-sdk-'));
async function moduleURL(name,source){const path=join(workspace,name+'.mjs');await writeFile(path,source);return pathToFileURL(path).href;}
async function localModel(name,replacements={}){let source=stripTypeScriptTypes(await readFile(new URL(`../../lib/${name}.ts`,import.meta.url),'utf8'));for(const[from,to]of Object.entries(replacements))source=source.replaceAll(JSON.stringify(from),JSON.stringify(to));return moduleURL(name,source);}
const communityURL=await localModel('community-restroom-model');
const passcodeURL=await localModel('passcode-model');
const requestURL=await localModel('restroom-request-model',{'@/lib/passcode-model':passcodeURL});
const requestModel=await import(requestURL);
const firebaseURL=import.meta.resolve('firebase/firestore');
const clientURL=await moduleURL('client','export const getFirebaseClient=()=>globalThis.__requestSDKClient;export const getFirebaseConfigurationError=()=>null;');
const wrappedFirebaseURL=await moduleURL('firebase',`
 import * as real from ${JSON.stringify(firebaseURL)};
 export * from ${JSON.stringify(firebaseURL)};
 export function getFirestore(){return globalThis.__requestSDKDatabase;}
 export function runTransaction(database,callback,options){
  const hooks=globalThis.__requestSDKHooks;hooks.reads++;
  if(hooks.failReads>0){hooks.failReads--;return Promise.reject({code:'unavailable'});}
  return real.runTransaction(database,callback,options);
 }
 export function writeBatch(database){
  const batch=real.writeBatch(database),commit=batch.commit.bind(batch);
  batch.commit=async()=>{
   const hooks=globalThis.__requestSDKHooks,mode=hooks.mode;hooks.mode=null;
   if(mode==='before-error')throw {code:'unavailable'};
   await commit();hooks.commits++;
   if(mode==='after-error')throw {code:'unavailable'};
   if(mode==='readback-error')hooks.failReads=1;
   if(mode==='account-change')globalThis.__requestSDKClient.auth.currentUser={uid:'bob',isAnonymous:false};
   if(mode==='same-uid-replacement')globalThis.__requestSDKClient.auth.currentUser={uid:'alice',isAnonymous:false};
  };return batch;
 }
`);
const source=stripTypeScriptTypes(await readFile(new URL('../../lib/community-restrooms.ts',import.meta.url),'utf8'))
 .replaceAll('"firebase/firestore"',JSON.stringify(wrappedFirebaseURL))
 .replaceAll('"@/lib/firebase-client"',JSON.stringify(clientURL))
 .replaceAll('"@/lib/community-restroom-model"',JSON.stringify(communityURL))
 .replaceAll('"@/lib/passcode-model"',JSON.stringify(passcodeURL))
 .replaceAll('"@/lib/restroom-request-model"',JSON.stringify(requestURL));
const api=await import(await moduleURL('service',source));
const input=()=>({name:'Neighborhood library',address:'1 Broadway, New York, NY',latitude:40.75,longitude:-73.98,locationType:'library',entryRule:'public',stepFreeAccess:'unknown',notes:'Ask at the desk.',observedOn:'2026-01-01',passcodeRequired:'unknown'});
const coded=(visibility='private')=>({...input(),passcodeRequired:'yes',passcode:{code:'0123#',visibility}});
const requestRef=db=>doc(db,'users','alice','restroomReadySubmissionRequests',ID);
const receiptRef=db=>doc(db,'restroomSubmissions',ID);
let env,alice,bob,reader;
function client(db,uid='alice',isAnonymous=false){globalThis.__requestSDKDatabase=db._delegate??db;globalThis.__requestSDKClient={app:db.app,auth:{currentUser:uid?{uid,isAnonymous}:null}};}
async function admin(action){let result;await env.withSecurityRulesDisabled(async context=>{result=await action(context.firestore());});return result;}
async function inspect(){return admin(async db=>({request:(await getDocFromServer(requestRef(db))).data(),receipt:(await getDocFromServer(receiptRef(db))).data()}));}
async function noPublicProjection(){await admin(async db=>{
 for(const path of [['communityRestrooms',ID],['restroomRatingSummaries',ID],['restroomPasscodeReports',ID],['users','alice','restroomReadyPasscodes',ID],['users','alice','restroomReadySaved',ID]])assert.equal((await getDocFromServer(doc(db,...path))).exists(),false,path.join('/'));
 assert.equal((await getDocsFromServer(query(collection(db,'restroomPasscodeReports',ID,'reports'),limit(10)))).size,0);
 for(const name of ['communityRestrooms','restroomRatingSummaries','restroomPasscodeOwners'])assert.equal((await getDocsFromServer(query(collection(db,name),limit(10)))).size,0,name);
});}
async function review(status,passcode=null){await admin(async db=>{
 const data=(await getDocFromServer(requestRef(db))).data();
 await setDoc(requestRef(db),{...data,status,revision:2,codeDraft:null,reviewedAt:Timestamp.fromMillis(data.submittedAt.toMillis()+1000),reason:status==='approved'?'':'duplicate',codeFingerprint:await requestModel.restroomRequestCodeFingerprint(passcode)});
});}
before(async()=>{
 setLogLevel('silent');const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8185'}`);
 env=await initializeTestEnvironment({projectId:'demo-restroom-community-request-sdk',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
 alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();bob=env.authenticatedContext('bob',{firebase:{sign_in_provider:'google.com'}}).firestore();reader=env.unauthenticatedContext().firestore();
});
beforeEach(async()=>{globalThis.__requestSDKHooks={mode:null,failReads:0,reads:0,commits:0};client(alice);await env.clearFirestore();});
after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}for(const name of ['Client','Database','Hooks'])delete globalThis['__requestSDK'+name];await rm(workspace,{recursive:true,force:true});});

test('SDK creates only a confirmed private pending pair with exact same server timestamps',async()=>{
 assert.match(api.newCommunityRestroomID(),/^community-[A-Za-z0-9]{20}$/);
 const result=await api.createCommunityRestroom('alice',input(),ID);assert.equal(result.id,ID);assert.equal(result.status,'pending');assert.equal(result.revision,1);assert.ok(result.submittedAt instanceof Date);assert.equal(result.reviewedAt,null);
 assert.deepEqual(Object.keys(result).sort(),['id','status','revision','submittedAt','reviewedAt','reason'].sort());
 const data=await inspect();assert.deepEqual(Object.keys(data.request).sort(),['schemaVersion','status','revision','submittedAt','listing','codeDraft'].sort());assert.equal(data.request.codeDraft,null);assert.deepEqual(Object.keys(data.receipt).sort(),['ownerUID','submittedAt']);
 assert.equal(data.request.submittedAt.isEqual(data.receipt.submittedAt),true);assert.equal(data.request.submittedAt.isEqual(data.request.listing.submittedAt),true);assert.equal(data.request.listing.observedOn.toDate().toISOString(),'2026-01-01T00:00:00.000Z');await noPublicProjection();
});
for(const visibility of ['private','public'])test(`SDK keeps optional ${visibility} code entirely in the owner pending request until approval`,async()=>{
 const result=await api.createCommunityRestroom('alice',coded(visibility),ID);const data=await inspect();assert.deepEqual(data.request.codeDraft,coded(visibility).passcode);assert.equal('passcode'in data.request.listing,false);assert.equal('code'in data.request.listing,false);assert.equal('codeDraft'in result,false);assert.equal('codeFingerprint'in result,false);await noPublicProjection();
 await assert.rejects(getDocFromServer(requestRef(reader)));await assert.rejects(getDocFromServer(requestRef(bob)));
});
test('same stable request retry is idempotent and changed listing/code/privacy cannot reuse it',async()=>{
 const original=await api.createCommunityRestroom('alice',coded(),ID);const again=await api.createCommunityRestroom('alice',coded(),ID);assert.equal(again.submittedAt.getTime(),original.submittedAt.getTime());assert.equal(globalThis.__requestSDKHooks.commits,1);
 for(const draft of [{...coded(),name:'Different'},coded('public'),{...coded(),passcode:{code:'9876',visibility:'private'}},input()])await assert.rejects(api.createCommunityRestroom('alice',draft,ID),/earlier version/);
 assert.equal((await getDocsFromServer(query(collection(alice,'users','alice','restroomReadySubmissionRequests'),limit(50)))).size,1);await noPublicProjection();
});
for(const status of ['approved','denied'])for(const withCode of [true,false])test(`SDK confirms exact ${status} terminal retry ${withCode?'with a scrubbed code':'without a code'}`,async()=>{
 const draft=withCode?coded():input();await api.createCommunityRestroom('alice',draft,ID);await review(status,draft.passcode??null);
 const result=await api.createCommunityRestroom('alice',draft,ID);assert.equal(result.status,status);assert.equal(result.revision,2);assert.ok(result.reviewedAt instanceof Date);assert.equal(result.reason,status==='approved'?'':'duplicate');assert.equal(globalThis.__requestSDKHooks.commits,1);assert.equal('codeFingerprint'in result,false);
 if(withCode){await assert.rejects(api.createCommunityRestroom('alice',coded('public'),ID),/different code/);await assert.rejects(api.createCommunityRestroom('alice',{...coded(),passcode:undefined},ID),/different code/);}
});
test('lost commit acknowledgement recovers exact server pair without a second write',async()=>{
 globalThis.__requestSDKHooks.mode='after-error';const result=await api.createCommunityRestroom('alice',coded(),ID);assert.equal(result.status,'pending');assert.equal(globalThis.__requestSDKHooks.commits,1);await noPublicProjection();
});
test('failed commit and failed confirmed read retain the original stable request for later retry',async()=>{
 globalThis.__requestSDKHooks.mode='before-error';await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/could not be confirmed/);assert.equal((await inspect()).request,undefined);
 globalThis.__requestSDKHooks.mode='readback-error';await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/could not be confirmed/);
 const result=await api.createCommunityRestroom('alice',input(),ID);assert.equal(result.status,'pending');assert.equal(globalThis.__requestSDKHooks.commits,1);
});
test('concurrent stable retries observe a coherent pair and create exactly one pending request',async()=>{
 const results=await Promise.all([api.createCommunityRestroom('alice',coded(),ID),api.createCommunityRestroom('alice',coded(),ID)]);assert.equal(results[0].submittedAt.getTime(),results[1].submittedAt.getTime());assert.equal((await getDocsFromServer(query(collection(alice,'users','alice','restroomReadySubmissionRequests'),limit(50)))).size,1);await noPublicProjection();
});
for(const mode of ['account-change','same-uid-replacement'])test(`late ${mode} cannot return success to a stale account scope`,async()=>{
 globalThis.__requestSDKHooks.mode=mode;await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/account changed/);
 assert.equal((await inspect()).request.status,'pending');client(alice);assert.equal((await api.createCommunityRestroom('alice',input(),ID)).status,'pending');
});
test('signed-out, anonymous, wrong owner and deletion-locked clients cannot submit',async()=>{
 client(reader,null);await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/Sign in/);
 client(alice,'alice',true);await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/Sign in/);
 client(bob,'bob');await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/account changed/);
 client(alice);await admin(db=>setDoc(doc(db,'accountDeletionLocks','alice'),{policyVersion:4,requestedAt:Timestamp.now()}));await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/authorized|confirmed/);assert.equal((await inspect()).request,undefined);
});
test('a different account cannot inspect or steal an existing stable request ID',async()=>{
 await api.createCommunityRestroom('alice',coded(),ID);client(bob,'bob');await assert.rejects(api.createCommunityRestroom('bob',coded(),ID),/authorized|confirmed/);assert.equal((await inspect()).receipt.ownerUID,'alice');await noPublicProjection();
});
for(const missing of ['request','receipt'])test(`one-sided ${missing} corruption fails closed without repairing or duplicating`,async()=>{
 await api.createCommunityRestroom('alice',input(),ID);await admin(db=>deleteDoc(missing==='request'?requestRef(db):receiptRef(db)));await assert.rejects(api.createCommunityRestroom('alice',input(),ID),/could not be confirmed safely/);assert.equal(globalThis.__requestSDKHooks.commits,1);
});
for(const corruption of ['receipt-date','listing-date','unknown-field','nested-legacy-schema','terminal-old-date','terminal-no-fingerprint'])test(`SDK refuses ${corruption} metadata rather than returning false success`,async()=>{
 await api.createCommunityRestroom('alice',coded(),ID);await admin(async db=>{
  const data=(await getDocFromServer(requestRef(db))).data();
  if(corruption==='receipt-date'){await setDoc(receiptRef(db),{ownerUID:'alice',submittedAt:new Timestamp(data.submittedAt.seconds+(data.submittedAt.nanoseconds>=999999000?1:0),(data.submittedAt.nanoseconds+1000)%1000000000)});return;}
  if(corruption==='listing-date')data.listing.submittedAt=new Timestamp(data.submittedAt.seconds+(data.submittedAt.nanoseconds>=999999000?1:0),(data.submittedAt.nanoseconds+1000)%1000000000);
  if(corruption==='unknown-field')data.extra='unexpected';
  if(corruption==='nested-legacy-schema')delete data.listing.passcodeRequired;
  if(corruption.startsWith('terminal-'))Object.assign(data,{status:'approved',revision:2,codeDraft:null,reason:'',reviewedAt:corruption==='terminal-old-date'?new Timestamp(data.submittedAt.seconds-1,data.submittedAt.nanoseconds):Timestamp.now(),codeFingerprint:corruption==='terminal-no-fingerprint'?null:await requestModel.restroomRequestCodeFingerprint(coded().passcode)});
  await setDoc(requestRef(db),data);
 });await assert.rejects(api.createCommunityRestroom('alice',coded(),ID),/confirmed safely|different code/);assert.equal(globalThis.__requestSDKHooks.commits,1);
});
test('invalid inputs and a code without its requirement produce no pending or public writes',async()=>{
 for(const draft of [{...input(),latitude:0},{...input(),ownerUID:'bob'},{...input(),passcode:{code:'1234',visibility:'private'}},{...coded(),passcode:{code:'\n1234',visibility:'private'}}])await assert.rejects(api.createCommunityRestroom('alice',draft,ID));
 await assert.rejects(api.createCommunityRestroom('alice',input(),'invalid'));assert.equal((await inspect()).request,undefined);assert.equal(globalThis.__requestSDKHooks.commits,0);await noPublicProjection();
});

test('existing anonymous public feed ignores pending requests and decodes approved legacy projections unchanged',async()=>{
 await api.createCommunityRestroom('alice',input(),ID);
 client(reader,null);
 const readFeed=expected=>new Promise((resolve,reject)=>{
  let stop=()=>{};const timer=setTimeout(()=>{stop();reject(new Error('Public community feed did not confirm its expected state'));},5000);
  stop=api.watchCommunityRestrooms(records=>{if(records.length===expected){clearTimeout(timer);stop();resolve(records);}},error=>{clearTimeout(timer);stop();reject(error);});
 });
 assert.deepEqual(await readFeed(0),[]);
 await admin(async db=>{const listing=(await getDocFromServer(requestRef(db))).data().listing;await setDoc(doc(db,'communityRestrooms',ID),listing);await setDoc(doc(db,'restroomRatingSummaries',ID),{ratingCount:0,ratingSum:0,updatedAt:listing.submittedAt});});
 const records=await readFeed(1);assert.equal(records[0].id,ID);assert.equal(records[0].name,input().name);assert.equal(records[0].observedOn,input().observedOn);const place=api.communityRestroomToPlace(records[0]);assert.equal(place.id,ID);assert.equal(place.communitySource.stepFreeAccess,'unknown');assert.equal(place.sourceRecordId,null);
});
