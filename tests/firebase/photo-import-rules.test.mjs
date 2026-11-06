import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PLACE='community-PhotoImportVenue0001', REPORT='PhotoImportReport001';
const IMPORTED=Timestamp.fromDate(new Date('2026-10-20T00:00:00Z'));
let env, reader, account, anonymousAccount;
const report=db=>doc(db,'restroomPasscodeReports',PLACE,'reports',REPORT);

before(async()=>{
  setLogLevel('silent');
  const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8088'}`);
  env=await initializeTestEnvironment({projectId:'demo-photo-restroom-import',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
  reader=env.unauthenticatedContext().firestore();
  account=env.authenticatedContext('real-test-verifier',{firebase:{sign_in_provider:'google.com'}}).firestore();
  anonymousAccount=env.authenticatedContext('anonymous-test',{firebase:{sign_in_provider:'anonymous'}}).firestore();
});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();const batch=writeBatch(db);
    batch.set(doc(db,'communityRestrooms',PLACE),{name:'Imported test venue',address:'143 Chambers Street, Manhattan, NY',latitude:40.715858,longitude:-74.009513,locationType:'cafe',entryRule:'unknown',stepFreeAccess:'unknown',notes:'Imported from an undated supplied photo. Not independently verified.',observedOn:null,submittedAt:IMPORTED,passcodeRequired:'yes'});
    batch.set(doc(db,'restroomRatingSummaries',PLACE),{ratingCount:0,ratingSum:0,updatedAt:IMPORTED});
    batch.set(doc(db,'restroomSubmissions',PLACE),{ownerUID:'system-photo-import',submittedAt:IMPORTED});
    batch.set(doc(db,'restroomPasscodeOwners',REPORT),{ownerUID:'system-photo-import',placeID:PLACE,createdAt:IMPORTED});
    batch.set(report(db),{placeID:PLACE,code:'0036#',codeUpdatedAt:IMPORTED,lastVerifiedAt:null});
    batch.set(doc(db,'photoImportSources','source-batch','rows','source-row'),{code:'staff-source-only',status:'withheld'});
    await batch.commit();
  });
});
after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}});

test('administrator imported public reports allow bounded anonymous reads with no invented verification',async()=>{
  const rows=await assertSucceeds(getDocsFromServer(query(collection(reader,'restroomPasscodeReports',PLACE,'reports'),orderBy('codeUpdatedAt','desc'),limit(10))));
  assert.equal(rows.size,1);assert.equal(rows.docs[0].data().code,'0036#');assert.equal(rows.docs[0].data().lastVerifiedAt,null);
  assert.equal((await assertSucceeds(getDocFromServer(doc(reader,'communityRestrooms',PLACE)))).data().observedOn,null);
});

test('administrator imported public codes support a real account version-pinned verification without a synthetic owner account',async()=>{
  const batch=writeBatch(account);
  batch.update(report(account),{lastVerifiedAt:serverTimestamp()});
  batch.set(doc(account,'users','real-test-verifier','restroomReadyPasscodeChecks',REPORT),{placeID:PLACE,codeUpdatedAt:IMPORTED,verifiedAt:serverTimestamp()});
  await assertSucceeds(batch.commit());
  const data=(await getDocFromServer(report(reader))).data();
  assert.ok(data.codeUpdatedAt.isEqual(IMPORTED));assert.equal(data.code,'0036#');assert.ok(data.lastVerifiedAt instanceof Timestamp);
  await assertFails(updateDoc(report(account),{code:'9999'}));
  await assertFails(deleteDoc(report(account)));
  await assertFails(updateDoc(report(anonymousAccount),{lastVerifiedAt:serverTimestamp()}));
});

test('administrator imported source credentials and service ownership remain unreadable and immutable to clients',async()=>{
  for(const db of[reader,account,anonymousAccount]){
    await assertFails(getDocFromServer(doc(db,'photoImportSources','source-batch','rows','source-row')));
    await assertFails(getDocsFromServer(collection(db,'photoImportSources','source-batch','rows')));
    await assertFails(getDocFromServer(doc(db,'restroomPasscodeOwners',REPORT)));
    await assertFails(setDoc(doc(db,'restroomPasscodeOwners',REPORT),{ownerUID:'real-test-verifier',placeID:PLACE,createdAt:serverTimestamp()}));
  }
});
