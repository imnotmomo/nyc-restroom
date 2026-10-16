import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit,
  orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PROJECT='demo-restroom-passcodes';
const PLACE='i7jb-7jku:row-xb7j_yzsr~cp6w',SECOND='i7jb-7jku:second-source';
const COMMUNITY='community-ABCDEFGHIJKLMNOPQRST',MISSING='i7jb-7jku:unlisted';
const REPORT='AAAAAAAAAAAAAAAAAAAA',OTHER_REPORT='BBBBBBBBBBBBBBBBBBBB';
const OLD=Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'));
let env,alice,bob,guest,out;
const own=(db,uid='alice',place=PLACE)=>doc(db,'users',uid,'restroomReadyPasscodes',place);
const owner=(db,id=REPORT)=>doc(db,'restroomPasscodeOwners',id);
const pub=(db,place=PLACE,id=REPORT)=>doc(db,'restroomPasscodeReports',place,'reports',id);
const check=(db,uid='bob',id=REPORT)=>doc(db,'users',uid,'restroomReadyPasscodeChecks',id);
const saved=(db,uid='alice',place=PLACE)=>doc(db,'users',uid,'restroomReadySaved',place);
const summary=(db,place=PLACE)=>doc(db,'restroomRatingSummaries',place);
const original=(place=PLACE,id=REPORT,visibility='private')=>({placeID:place,reportID:id,code:'1234#',visibility,createdAt:serverTimestamp(),codeUpdatedAt:serverTimestamp(),lastVerifiedAt:null});
const publicData=data=>({placeID:data.placeID,code:data.code,codeUpdatedAt:data.codeUpdatedAt,lastVerifiedAt:data.lastVerifiedAt});

function create(db,{uid='alice',place=PLACE,id=REPORT,visibility='private',payload,omit=[],reservation}={}){
  const data=payload??original(place,id,visibility);const batch=writeBatch(db);
  if(!omit.includes('own'))batch.set(own(db,uid,place),data);
  if(!omit.includes('reservation'))batch.set(owner(db,id),reservation??{ownerUID:uid,placeID:place,createdAt:serverTimestamp()});
  if(data.visibility==='private'&&!omit.includes('saved'))batch.set(saved(db,uid,place),{placeID:place,savedAt:serverTimestamp()});
  if(data.visibility==='public'&&!omit.includes('public'))batch.set(pub(db,place,id),publicData(data));
  return batch.commit();
}
async function edit(db,{uid='alice',place=PLACE,code,visibility,verify=false,omit=[],override={}}={}){
  const before=(await getDocFromServer(own(db,uid,place))).data();
  const beforePublic=before.visibility==='public'?(await getDocFromServer(pub(db,place,before.reportID))).data():null;
  const changed=code!==undefined&&code!==before.code;
  const after={...before,code:code??before.code,visibility:visibility??before.visibility,
    codeUpdatedAt:changed?serverTimestamp():before.codeUpdatedAt,
    lastVerifiedAt:changed?null:verify?serverTimestamp():beforePublic?.lastVerifiedAt??before.lastVerifiedAt,...override};
  const batch=writeBatch(db);batch.set(own(db,uid,place),after);
  if(after.visibility==='private'&&!omit.includes('saved'))batch.set(saved(db,uid,place),{placeID:place,savedAt:serverTimestamp()});
  if(after.visibility==='public'&&!omit.includes('public'))batch.set(pub(db,place,before.reportID),publicData(after));
  if(before.visibility==='public'&&after.visibility==='private'&&!omit.includes('public'))batch.delete(pub(db,place,before.reportID));
  return batch.commit();
}
async function verify(db,{uid='bob',place=PLACE,id=REPORT,version,extra={},omit=[]}={}){
  const before=(await getDocFromServer(pub(db,place,id))).data();
  const batch=writeBatch(db);
  if(!omit.includes('public'))batch.update(pub(db,place,id),{lastVerifiedAt:serverTimestamp(),...extra});
  if(!omit.includes('receipt'))batch.set(check(db,uid,id),{placeID:place,codeUpdatedAt:version??before.codeUpdatedAt,verifiedAt:serverTimestamp()});
  return batch.commit();
}
async function remove(db,{uid='alice',place=PLACE,omit=[]}={}){
  const before=(await getDocFromServer(own(db,uid,place))).data();const batch=writeBatch(db);
  if(!omit.includes('own'))batch.delete(own(db,uid,place));
  if(!omit.includes('reservation'))batch.delete(owner(db,before.reportID));
  if(before.visibility==='public'&&!omit.includes('public'))batch.delete(pub(db,place,before.reportID));
  return batch.commit();
}
function community(db,{visibility='private',omit=[],passcodeRequired='yes',includeCode=true}={}){
  const batch=writeBatch(db);const place=COMMUNITY;
  if(!omit.includes('listing'))batch.set(doc(db,'communityRestrooms',place),{name:'Test restroom',address:'123 Test Street, New York, NY',latitude:40.75,longitude:-73.98,locationType:'cafe',entryRule:'customers',stepFreeAccess:'unknown',notes:'',observedOn:null,submittedAt:serverTimestamp(),passcodeRequired});
  if(!omit.includes('receipt'))batch.set(doc(db,'restroomSubmissions',place),{ownerUID:'alice',submittedAt:serverTimestamp()});
  if(!omit.includes('summary'))batch.set(summary(db,place),{ratingCount:0,ratingSum:0,updatedAt:serverTimestamp()});
  if(includeCode){
    const data=original(place,REPORT,visibility);
    if(!omit.includes('own'))batch.set(own(db,'alice',place),data);
    if(!omit.includes('reservation'))batch.set(owner(db),{ownerUID:'alice',placeID:place,createdAt:serverTimestamp()});
    if(visibility==='private'&&!omit.includes('saved'))batch.set(saved(db,'alice',place),{placeID:place,savedAt:serverTimestamp()});
    if(visibility==='public'&&!omit.includes('public'))batch.set(pub(db,place),publicData(data));
  }
  return batch.commit();
}

describe('passcode privacy, ownership, freshness and atomicity',{concurrency:false},()=>{
  before(async()=>{
    setLogLevel('silent');const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8088'}`);
    env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
    alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();
    bob=env.authenticatedContext('bob',{firebase:{sign_in_provider:'google.com'}}).firestore();
    guest=env.authenticatedContext('guest',{firebase:{sign_in_provider:'anonymous'}}).firestore();out=env.unauthenticatedContext().firestore();
  });
  beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{for(const place of[PLACE,SECOND])await setDoc(summary(ctx.firestore(),place),{ratingCount:0,ratingSum:0,updatedAt:OLD});});});
  after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}});

  test('private creation reserves ownership, saves the place and exposes no public code',async()=>{
    await assertSucceeds(create(alice));const data=(await getDocFromServer(own(alice))).data();
    assert.equal(data.code,'1234#');assert.equal(data.lastVerifiedAt,null);assert.ok(data.createdAt.isEqual(data.codeUpdatedAt));
    assert.equal((await getDocFromServer(saved(alice))).data().placeID,PLACE);assert.equal((await getDocFromServer(pub(out))).exists(),false);
    assert.equal((await getDocFromServer(owner(alice))).data().ownerUID,'alice');
    for(const db of[bob,guest,out]){await assertFails(getDocFromServer(own(db)));await assertFails(getDocFromServer(owner(db)));}
  });
  test('public creation exposes exactly four code fields and requires no favorite',async()=>{
    await assertSucceeds(create(alice,{visibility:'public'}));const data=(await getDocFromServer(pub(out))).data();
    assert.deepEqual(Object.keys(data).sort(),['code','codeUpdatedAt','lastVerifiedAt','placeID']);assert.equal(data.lastVerifiedAt,null);
    assert.equal((await getDocFromServer(saved(alice))).exists(),false);
    const q=query(collection(out,'restroomPasscodeReports',PLACE,'reports'),orderBy('codeUpdatedAt','desc'),limit(10));
    assert.equal((await assertSucceeds(getDocsFromServer(q))).size,1);
    await assertFails(getDocsFromServer(collection(out,'restroomPasscodeReports',PLACE,'reports')));
    await assertFails(getDocsFromServer(query(collection(out,'restroomPasscodeReports',PLACE,'reports'),limit(11))));
    await assertFails(getDocsFromServer(collectionGroup(out,'reports')));
  });
  test('private reads and collection groups stay owner-scoped',async()=>{
    await create(alice);assert.equal((await getDocsFromServer(collection(alice,'users','alice','restroomReadyPasscodes'))).size,1);
    for(const db of[alice,bob,out]){
      await assertFails(getDocsFromServer(collectionGroup(db,'restroomReadyPasscodes')));
      await assertFails(getDocsFromServer(collection(db,'restroomPasscodeOwners')));
      await assertFails(getDocsFromServer(collectionGroup(db,'restroomReadyPasscodeChecks')));
    }
  });
  for(const field of['own','reservation','saved'])test(`private creation requires paired ${field}`,async()=>{await assertFails(create(alice,{omit:[field]}));});
  test('public creation requires its paired projection',async()=>{await assertFails(create(alice,{visibility:'public',omit:['public']}));});
  test('signed-out and anonymous-provider accounts cannot create private or public codes',async()=>{
    for(const db of[out,guest])for(const visibility of['private','public'])await assertFails(create(db,{visibility,uid:db===guest?'guest':'alice'}));
  });
  test('known official containers or valid community membership are required',async()=>{
    for(const place of[MISSING,'community-QRSTUVWXYZABCDEFGHIJ','community-bad'])await assertFails(create(alice,{place}));
  });
  test('another user cannot copy a public report ID to steal ownership or delete its projection',async()=>{
    await create(alice,{visibility:'public'});await assertFails(create(bob,{uid:'bob',visibility:'private'}));
    await assertFails(create(bob,{uid:'bob',visibility:'public'}));await assertFails(updateDoc(owner(bob),{ownerUID:'bob'}));
    await assertFails(deleteDoc(pub(bob)));await assertFails(updateDoc(pub(bob),{code:'hijacked'}));
    assert.equal((await getDocFromServer(pub(out))).data().code,'1234#');
  });
  test('separate accounts retain independent codes and visibility changes cannot remove another report',async()=>{
    await create(alice,{visibility:'public'});await create(bob,{uid:'bob',id:OTHER_REPORT,visibility:'public',payload:original(PLACE,OTHER_REPORT,'public')});
    await edit(alice,{visibility:'private'});assert.equal((await getDocFromServer(pub(out))).exists(),false);
    assert.equal((await getDocFromServer(pub(out,PLACE,OTHER_REPORT))).data().code,'1234#');
    await assertFails(deleteDoc(pub(alice,PLACE,OTHER_REPORT)));
  });
  test('publishing and making private preserve only genuine verification and require atomic projection changes',async()=>{
    await create(alice);await edit(alice,{verify:true});const verified=(await getDocFromServer(own(alice))).data().lastVerifiedAt;
    await assertFails(edit(alice,{visibility:'public',omit:['public']}));await assertSucceeds(edit(alice,{visibility:'public'}));
    assert.ok((await getDocFromServer(pub(out))).data().lastVerifiedAt.isEqual(verified));
    await verify(bob);const communityCheck=(await getDocFromServer(pub(out))).data().lastVerifiedAt;
    await assertFails(edit(alice,{visibility:'private',omit:['public']}));await assertSucceeds(edit(alice,{visibility:'private'}));
    assert.ok((await getDocFromServer(own(alice))).data().lastVerifiedAt.isEqual(communityCheck));assert.equal((await getDocFromServer(pub(out))).exists(),false);
    await edit(alice,{visibility:'public'});assert.ok((await getDocFromServer(pub(out))).data().lastVerifiedAt.isEqual(communityCheck));
  });
  test('code changes reset checks and update only the code timestamp',async()=>{
    await create(alice,{visibility:'public'});await verify(bob);const before=(await getDocFromServer(own(alice))).data();
    await assertSucceeds(edit(alice,{code:'5678*'}));const after=(await getDocFromServer(own(alice))).data();const publicAfter=(await getDocFromServer(pub(out))).data();
    assert.ok(after.createdAt.isEqual(before.createdAt));assert.ok(after.codeUpdatedAt.toMillis()>=before.codeUpdatedAt.toMillis());
    assert.equal(after.lastVerifiedAt,null);assert.equal(publicAfter.lastVerifiedAt,null);assert.equal(publicAfter.code,'5678*');
    await assertFails(edit(alice,{code:'9999',override:{codeUpdatedAt:after.codeUpdatedAt}}));
    await assertFails(edit(alice,{code:'9999',override:{lastVerifiedAt:serverTimestamp()}}));
  });
  test('saving or publishing cannot forge a verification time or refresh code time without a code change',async()=>{
    await assertFails(create(alice,{payload:{...original(),lastVerifiedAt:serverTimestamp()}}));await create(alice);
    await assertFails(edit(alice,{visibility:'public',override:{lastVerifiedAt:serverTimestamp()}}));
    await assertFails(edit(alice,{override:{codeUpdatedAt:serverTimestamp()}}));
    await assertFails(edit(alice,{override:{lastVerifiedAt:OLD}}));
  });
  test('explicit private verification preserves codeUpdatedAt and auto-saves after a normal unsave',async()=>{
    await create(alice);const before=(await getDocFromServer(own(alice))).data();await assertSucceeds(deleteDoc(saved(alice)));
    await assertFails(updateDoc(own(alice),{lastVerifiedAt:serverTimestamp()}));await assertSucceeds(edit(alice,{verify:true}));
    const after=(await getDocFromServer(own(alice))).data();assert.ok(after.codeUpdatedAt.isEqual(before.codeUpdatedAt));assert.ok(after.lastVerifiedAt instanceof Timestamp);
    assert.equal((await getDocFromServer(saved(alice))).exists(),true);
  });
  test('existing favorite timestamps need not be refreshed by private code updates',async()=>{
    await create(alice);const before=(await getDocFromServer(saved(alice))).data().savedAt;
    await assertSucceeds(edit(alice,{code:'5678',omit:['saved']}));assert.ok((await getDocFromServer(saved(alice))).data().savedAt.isEqual(before));
  });
  test('another signed-in visitor verifies only the exact public version with a private fresh receipt',async()=>{
    await create(alice,{visibility:'public'});await assertSucceeds(verify(bob));const data=(await getDocFromServer(pub(out))).data();
    const receipt=(await getDocFromServer(check(bob))).data();assert.ok(data.lastVerifiedAt.isEqual(receipt.verifiedAt));assert.ok(data.codeUpdatedAt.isEqual(receipt.codeUpdatedAt));
    for(const db of[alice,guest,out])await assertFails(getDocFromServer(check(db)));
    await assertFails(getDocsFromServer(collection(bob,'users','bob','restroomReadyPasscodeChecks')));
    await assertSucceeds(verify(bob));
  });
  for(const part of['receipt','public'])test(`public verification cannot omit paired ${part}`,async()=>{await create(alice,{visibility:'public'});await assertFails(verify(bob,{omit:[part]}));});
  test('unpaired timestamp replay, stale version, forged fields and anonymous verification fail',async()=>{
    await create(alice,{visibility:'public'});const stale=(await getDocFromServer(pub(out))).data().codeUpdatedAt;await verify(bob);
    await assertFails(updateDoc(pub(bob),{lastVerifiedAt:serverTimestamp()}));
    await assertFails(verify(bob,{extra:{code:'replace'}}));await assertFails(verify(bob,{extra:{ownerUID:'bob'}}));
    await edit(alice,{code:'new-code'});await assertFails(verify(bob,{version:stale}));
    await assertFails(verify(guest,{uid:'guest'}));await assertFails(verify(out));
    await edit(alice,{visibility:'private'});await assertFails(setDoc(check(bob),{placeID:PLACE,codeUpdatedAt:stale,verifiedAt:serverTimestamp()}));
  });
  test('public owner cannot silently erase a newer visitor verification with a same-code update',async()=>{
    await create(alice,{visibility:'public'});await verify(bob);const before=(await getDocFromServer(pub(out))).data();
    await assertFails(updateDoc(pub(alice),{lastVerifiedAt:null}));await assertSucceeds(edit(alice));
    assert.ok((await getDocFromServer(pub(out))).data().lastVerifiedAt.isEqual(before.lastVerifiedAt));
  });
  test('deleting a code atomically removes its reservation and public projection, retaining favorites',async()=>{
    await create(alice);await edit(alice,{visibility:'public'});
    for(const missing of['own','reservation','public'])await assertFails(remove(alice,{omit:[missing]}));
    await assertSucceeds(remove(alice));assert.equal((await getDocFromServer(own(alice))).exists(),false);
    assert.equal((await getDocFromServer(pub(out))).exists(),false);assert.equal((await getDocFromServer(owner(alice))).exists(),false);assert.equal((await getDocFromServer(saved(alice))).exists(),true);
  });
  test('private deletion cannot leave its owner reservation orphaned',async()=>{await create(alice);await assertFails(deleteDoc(own(alice)));await assertFails(deleteDoc(owner(alice)));await assertSucceeds(remove(alice));});
  const invalid=[
    ['empty code',d=>({...d,code:''})],['whitespace code',d=>({...d,code:'   '})],['leading space',d=>({...d,code:' 123'})],['trailing space',d=>({...d,code:'123 '})],
    ['long code',d=>({...d,code:'x'.repeat(41)})],['nonstring code',d=>({...d,code:1234})],['newline',d=>({...d,code:'12\n34'})],['control',d=>({...d,code:'12\u000034'})],['unicode',d=>({...d,code:'１２３４'})],
    ['invalid visibility',d=>({...d,visibility:'all'})],['forged identity',d=>({...d,ownerUID:'alice'})],['privilege',d=>({...d,isAdmin:true})],['missing field',d=>{const x={...d};delete x.lastVerifiedAt;return x;}],
    ['bad report ID',d=>({...d,reportID:'short'})],['past created time',d=>({...d,createdAt:OLD})],['future code time',d=>({...d,codeUpdatedAt:Timestamp.fromMillis(Date.now()+86400000)})],['timestamp string',d=>({...d,lastVerifiedAt:'now'})],
  ];
  for(const[name,mutate]of invalid)test(`strict private create and update reject ${name}`,async()=>{
    await assertFails(create(alice,{payload:mutate(original())}));await create(alice);
    const data=(await getDocFromServer(own(alice))).data();await assertFails(setDoc(own(alice),mutate(data)));
  });
  test('immutable place/report/created fields and reservation schemas resist account and venue hijacks',async()=>{
    await create(alice);const data=(await getDocFromServer(own(alice))).data();
    for(const patch of[{placeID:SECOND},{reportID:OTHER_REPORT},{createdAt:serverTimestamp()},{ownerUID:'bob'}])await assertFails(updateDoc(own(alice),patch));
    for(const patch of[{ownerUID:'bob'},{placeID:SECOND},{createdAt:serverTimestamp()},{email:'x@example.test'}])await assertFails(updateDoc(owner(alice),patch));
    await assertFails(setDoc(own(bob),data));await assertFails(create(bob,{uid:'alice',id:OTHER_REPORT}));
  });
  test('public projections reject identity pollution and oversized or mismatched code copies',async()=>{
    await create(alice,{visibility:'public'});const data=(await getDocFromServer(pub(out))).data();
    for(const patch of[{email:'x@example.test'},{isAdmin:true},{code:'x'.repeat(100000)},{placeID:SECOND},{codeUpdatedAt:OLD},{lastVerifiedAt:Timestamp.fromMillis(Date.now()+86400000)}])await assertFails(setDoc(pub(alice),{...data,...patch}));
  });
  test('a copied reservation ID cannot be injected through a private record update',async()=>{
    await create(alice,{visibility:'public'});await create(bob,{uid:'bob',id:OTHER_REPORT});
    await assertFails(updateDoc(own(bob,'bob'),{reportID:REPORT,visibility:'public'}));
    const batch=writeBatch(bob);batch.delete(owner(bob,OTHER_REPORT));batch.set(owner(bob),{ownerUID:'bob',placeID:PLACE,createdAt:serverTimestamp()});
    batch.update(own(bob,'bob'),{reportID:REPORT,visibility:'public'});await assertFails(batch.commit());
  });
  test('verification receipt schemas, scope and timestamps cannot be forged with a paired public update',async()=>{
    await create(alice,{visibility:'public'});const before=(await getDocFromServer(pub(out))).data();
    const cases=[{placeID:SECOND},{codeUpdatedAt:OLD},{verifiedAt:OLD},{verifiedAt:'now'},{email:'x@example.test'},{ownerUID:'bob'}];
    for(const patch of cases){const batch=writeBatch(bob);batch.update(pub(bob),{lastVerifiedAt:serverTimestamp()});batch.set(check(bob),{placeID:PLACE,codeUpdatedAt:before.codeUpdatedAt,verifiedAt:serverTimestamp(),...patch});await assertFails(batch.commit());}
    await assertFails(deleteDoc(check(bob)));
  });
  test('existing verification receipts cannot be reused without a new timestamp on that exact version',async()=>{
    await create(alice,{visibility:'public'});await verify(bob);const receipt=(await getDocFromServer(check(bob))).data();
    const batch=writeBatch(bob);batch.update(pub(bob),{lastVerifiedAt:serverTimestamp()});batch.set(check(bob),receipt);await assertFails(batch.commit());
    const justReceipt=writeBatch(bob);justReceipt.set(check(bob),{...receipt,verifiedAt:serverTimestamp()});await assertFails(justReceipt.commit());
  });
  test('two accounts can confirm a public code without changing its ownership or code version',async()=>{
    await create(alice,{visibility:'public'});const before=(await getDocFromServer(pub(out))).data();
    const results=await Promise.allSettled([verify(alice,{uid:'alice'}),verify(bob)]);
    for(const result of results)assert.equal(result.status,'fulfilled',result.status==='rejected'?String(result.reason):undefined);
    const after=(await getDocFromServer(pub(out))).data();const a=(await getDocFromServer(check(alice,'alice'))).data();const b=(await getDocFromServer(check(bob))).data();
    assert.equal(after.code,before.code);assert.ok(after.codeUpdatedAt.isEqual(before.codeUpdatedAt));
    assert.ok(after.lastVerifiedAt.isEqual(a.verifiedAt)||after.lastVerifiedAt.isEqual(b.verifiedAt));
    assert.equal((await getDocFromServer(owner(alice))).data().ownerUID,'alice');
  });
  test('public verification cannot mutate a private owner record or another verifier receipt',async()=>{
    await create(alice,{visibility:'public'});await assertFails(updateDoc(own(bob),{lastVerifiedAt:serverTimestamp()}));
    const data=(await getDocFromServer(pub(out))).data();const batch=writeBatch(bob);batch.update(pub(bob),{lastVerifiedAt:serverTimestamp()});batch.set(check(bob,'alice'),{placeID:PLACE,codeUpdatedAt:data.codeUpdatedAt,verifiedAt:serverTimestamp()});await assertFails(batch.commit());
  });
  test('every required owner field is preserved on updates',async()=>{
    await create(alice);const before=(await getDocFromServer(own(alice))).data();
    for(const field of Object.keys(before)){const data={...before};delete data[field];await assertFails(setDoc(own(alice),data));}
  });
  test('a removed report cannot be refreshed with its historical verification receipt',async()=>{
    await create(alice,{visibility:'public'});await verify(bob);const receipt=(await getDocFromServer(check(bob))).data();await remove(alice);
    const batch=writeBatch(bob);batch.set(pub(bob),{placeID:PLACE,code:'1234#',codeUpdatedAt:receipt.codeUpdatedAt,lastVerifiedAt:serverTimestamp()});batch.set(check(bob),{...receipt,verifiedAt:serverTimestamp()});await assertFails(batch.commit());
  });
  test('new community creation can atomically include a private code and saved place',async()=>{
    await assertSucceeds(community(alice));assert.equal((await getDocFromServer(own(alice,'alice',COMMUNITY))).data().visibility,'private');
    assert.equal((await getDocFromServer(saved(alice,'alice',COMMUNITY))).exists(),true);assert.equal((await getDocFromServer(doc(out,'communityRestrooms',COMMUNITY))).data().passcodeRequired,'yes');
  });
  test('new community creation can include a public code without leaking code into listing fields',async()=>{
    await assertSucceeds(community(alice,{visibility:'public'}));const listing=(await getDocFromServer(doc(out,'communityRestrooms',COMMUNITY))).data();
    assert.equal(listing.code,undefined);assert.equal(listing.visibility,undefined);assert.equal((await getDocFromServer(pub(out,COMMUNITY))).data().code,'1234#');
  });
  for(const missing of['listing','receipt','summary','own','reservation','saved'])test(`community plus private-code batch rejects missing ${missing}`,async()=>{await assertFails(community(alice,{omit:[missing]}));});
  test('a yes requirement can be reported without knowing or publishing a code',async()=>{await assertSucceeds(community(alice,{includeCode:false}));assert.equal((await getDocFromServer(pub(out,COMMUNITY))).exists(),false);});
  test('community code-required enum rejects arbitrary values without weakening legacy records',async()=>{for(const flag of['maybe',true,4,null])await assertFails(community(alice,{passcodeRequired:flag,includeCode:false}));});
  test('passcode operations cannot smuggle profile roles or arbitrary nested documents',async()=>{
    await create(alice);for(const path of['users/alice','roles/alice',`restroomPasscodeReports/${PLACE}/identity/alice`])await assertFails(setDoc(doc(alice,path),{isAdmin:true}));
  });
});
