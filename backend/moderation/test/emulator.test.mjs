import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, beforeEach, after, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, serverTimestamp, writeBatch, Timestamp as ClientTimestamp, setLogLevel } from 'firebase/firestore';
import { FileModeratorRoster } from '../src/auth.mjs';
import { createModerationService } from '../src/service.mjs';
import { httpServer } from '../src/server.mjs';
import { codeFingerprint, revision } from '../src/policy.mjs';
import { cleanupAccount } from '../../account-deletion/src/cleanup.mjs';
import { DELETION_POLICY_VERSION } from '../../account-deletion/src/policy.mjs';

// Hard fail before constructing either Admin client. This file never accepts a live project,
// remote endpoint, credential file, or ambient default emulator configuration.
const PROJECT='demo-moderation-backend',FS='127.0.0.1:8185',AUTH='127.0.0.1:9099';
assert.equal(PROJECT,'demo-moderation-backend');assert.ok(PROJECT.startsWith('demo-'));
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,FS);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,AUTH);
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,undefined);
const AUTH_URL=`http://${AUTH}`,ORIGIN='http://127.0.0.1:5101';
const ID=`community-${'A'.repeat(20)}`,SECOND=`community-${'B'.repeat(20)}`,THIRD=`community-${'C'.repeat(20)}`;
const PLACE='i7jb-7jku:moderation-backend',NOTE='N'.repeat(20),VISIT='V'.repeat(20),CODE='K'.repeat(20);
const OLD=new Timestamp(Math.floor(Date.UTC(2026,9,1)/1000),123456000),OBSERVED=new Timestamp(OLD.seconds-86400,123456000);
const list=()=>({name:'Synthetic emulator library',address:'1 Fixture Street, New York, NY',latitude:40.75,longitude:-73.98,locationType:'library',entryRule:'public',stepFreeAccess:'unknown',passcodeRequired:'unknown',notes:'Synthetic fixture.',observedOn:null,submittedAt:OLD});
const reqRef=(id=ID,uid=owner.uid)=>db.doc(`users/${uid}/restroomReadySubmissionRequests/${id}`);
const receiptRef=(id=ID)=>db.doc(`restroomSubmissions/${id}`);
const placeRef=(id=ID)=>db.doc(`communityRestrooms/${id}`);
const summaryRef=(id=ID)=>db.doc(`restroomRatingSummaries/${id}`);
const pathFor=kind=>kind==='public-note'?{root:'restroomPublicNotes',group:'notes',receipt:'restroomReadyPublicNoteReceipts',marker:'publicNotes',text:'body'}:{root:'restroomUnifiedVisits',group:'reports',receipt:'restroomReadyUnifiedVisitReceipts',marker:'unifiedVisits',text:'comment'};
const publicRef=(kind,id=kind==='public-note'?NOTE:VISIT,place=PLACE)=>{const p=pathFor(kind);return db.doc(`${p.root}/${place}/${p.group}/${id}`);};
const ownRef=(kind,id=kind==='public-note'?NOTE:VISIT,uid=owner.uid)=>db.doc(`users/${uid}/${pathFor(kind).receipt}/${id}`);
const markerRef=(kind,id=kind==='public-note'?NOTE:VISIT)=>db.doc(`restroomModerationRemovals/${PLACE}/${pathFor(kind).marker}/${id}`);
let app,db,auth,environment,owner,moderator,other,secondModerator,roster,service,server,base,clock,workspace,rosterPath;

async function authRequest(path,body,method='POST'){
 const response=await fetch(`${AUTH_URL}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();assert.equal(response.status,200,`Auth emulator fixture operation failed: ${data.error?.message??response.status}`);return data;
}
async function google(subject,email,verified=true){
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const providerToken=`${encode({alg:'none',typ:'JWT'})}.${encode({sub:subject,email,email_verified:verified,name:'Emulator fixture'})}.`;
 const data=await authRequest('/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=emulator-only',{targetProjectId:PROJECT,postBody:new URLSearchParams({id_token:providerToken,providerId:'google.com'}).toString(),requestUri:'http://localhost',returnSecureToken:true});
 const claims=JSON.parse(Buffer.from(data.idToken.split('.')[1],'base64url').toString());assert.equal(claims.aud,PROJECT);assert.equal(claims.firebase.sign_in_provider,'google.com');
 return {uid:data.localId,token:data.idToken,email};
}
async function call(path,{method='GET',body,token=moderator.token,origin=ORIGIN}={}){
 const response=await fetch(base+'/api/moderation/'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal(response.headers.get('cache-control'),'no-store');return {status:response.status,data:await response.json()};
}
const decision=(decision='approve',overrides={})=>({decision,revision:1,reason:decision==='approve'?'':'duplicate',actionId:randomUUID(),...overrides});
async function seedRequest({id=ID,uid=owner.uid,code=null,at=OLD,listing={},request={},receipt={}}={}){
 const batch=db.batch();batch.set(reqRef(id,uid),{schemaVersion:1,status:'pending',revision:1,submittedAt:at,listing:{...list(),...(code?{passcodeRequired:'yes'}:{}),submittedAt:at,...listing},codeDraft:code,...request});batch.set(receiptRef(id),{ownerUID:uid,submittedAt:at,...receipt});await batch.commit();
}
async function assertNoPublication(id=ID){for(const ref of [placeRef(id),summaryRef(id),db.doc(`users/${owner.uid}/restroomReadyPasscodes/${id}`),db.doc(`users/${owner.uid}/restroomReadySaved/${id}`)])assert.equal((await ref.get()).exists,false,ref.path);assert.equal((await db.collection('restroomPasscodeOwners').get()).size,0);assert.equal((await db.collection('restroomPasscodeReports').doc(id).collection('reports').get()).size,0);}
function noteData(kind,{structured=false,text='Synthetic public comment.',at=OLD,...extra}={}){
 const data={schemaVersion:1,placeID:PLACE,observedAt:OBSERVED,submittedAt:at,condition:'not-reported',soap:structured?'yes':'not-reported',toiletPaper:'not-reported',stairs:'not-reported'};
 return kind==='public-note'?{...data,body:text,...extra}:{...data,entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',floor:'not-reported',comment:text,anonymous:true,authorName:null,...extra};
}
async function seedComment(kind,{id=kind==='public-note'?NOTE:VISIT,uid=owner.uid,receipt={},...options}={}){
 const data=noteData(kind,options),batch=db.batch();batch.set(publicRef(kind,id),data);batch.set(ownRef(kind,id,uid),{placeID:PLACE,submittedAt:data.submittedAt,...(kind==='unified-visit'?{codeReportID:null}:{}),...receipt});await batch.commit();return (await publicRef(kind,id).get());
}
async function removeComment(kind,{id=kind==='public-note'?NOTE:VISIT,...overrides}={}){
 const snapshot=await publicRef(kind,id).get();const body={revision:revision(snapshot.updateTime),reason:'spam',actionId:randomUUID(),...overrides};return {...await call(`comments/${kind}/${PLACE}/${id}/remove`,{method:'POST',body}),body};
}
async function assertNoSensitiveReceipt(data,code=null){const text=JSON.stringify(data);for(const value of [owner.uid,`users/${owner.uid}`,code,code?codeFingerprint({code,visibility:'private'}):null].filter(Boolean))assert.equal(text.includes(value),false);}
async function leaseFor(uid){return {async check(transaction){const value=(await transaction.get(db.doc(`accountDeletionLocks/${uid}`))).data();assert.equal(value?.phase,'pending');assert.equal(value?.policyVersion,DELETION_POLICY_VERSION);return value;}};}

before(async()=>{
 setLogLevel('silent');workspace=await mkdtemp(join(tmpdir(),'rr-moderation-backend-'));
 app=initializeApp({projectId:PROJECT},'moderation-backend-independent-test');db=getFirestore(app);auth=getAuth(app);
 environment=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8185,rules:await readFile(new URL('../../../firebase/firestore.rules',import.meta.url),'utf8')}});
 server=httpServer({session:(...args)=>service.session(...args),requests:(...args)=>service.requests(...args),decide:(...args)=>service.decide(...args),comments:(...args)=>service.comments(...args),remove:(...args)=>service.remove(...args),reportContent:(...args)=>service.reportContent(...args),reports:(...args)=>service.reports(...args),resolveReport:(...args)=>service.resolveReport(...args),contributionStatus:(...args)=>service.contributionStatus(...args)},{allowedOrigin:ORIGIN});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
});
beforeEach(async()=>{
 await environment.clearFirestore();await authRequest(`/emulator/v1/projects/${PROJECT}/accounts`,null,'DELETE');
 [moderator,owner,other,secondModerator]=await Promise.all([google('backend-moderator','moderator@example.test'),google('backend-owner','owner@example.test'),google('backend-other','other@example.test'),google('backend-second-moderator','second-moderator@example.test')]);
 clock=Date.now();rosterPath=join(workspace,randomUUID()+'.json');roster=new FileModeratorRoster({path:rosterPath,bootstrapEmail:moderator.email});service=createModerationService({auth,db,roster,now:()=>clock,safetyReady:async()=>true});
 await db.doc(`restroomRatingSummaries/${PLACE}`).set({ratingCount:0,ratingSum:0,updatedAt:OLD});
});
after(async()=>{
 if(server)await new Promise(resolve=>server.close(resolve));
 if(environment){try{await environment.clearFirestore();await authRequest(`/emulator/v1/projects/${PROJECT}/accounts`,null,'DELETE');}finally{await environment.cleanup();}}
 if(db)await db.terminate();if(app)await deleteApp(app);if(workspace)await rm(workspace,{recursive:true,force:true});
});

test('actual emulator Google token, live Auth user and file roster protect the HTTP API',async()=>{
 assert.equal((await call('session',{token:null})).status,401);assert.equal((await call('session',{token:other.token})).status,403);
 const result=await call('session');assert.equal(result.status,200);assert.equal(result.data.role,'moderator');assert.equal(result.data.user.email,moderator.email);assert.deepEqual(JSON.parse(await readFile(rosterPath,'utf8')).uids,[moderator.uid]);
 await auth.updateUser(moderator.uid,{disabled:true});assert.equal((await call('session')).status,401);await auth.updateUser(moderator.uid,{disabled:false,emailVerified:false});assert.equal((await call('session')).status,401);
});
test('real token revocation and deleted Auth accounts are rejected',async()=>{
 await call('session');await new Promise(resolve=>setTimeout(resolve,1100));await auth.revokeRefreshTokens(moderator.uid);assert.equal((await call('session')).status,401);
 await auth.deleteUser(other.uid);assert.equal((await call('session',{token:other.token})).status,401);
});
for(const visibility of [null,'private','public'])test(`approval atomically publishes exact original listing and ${visibility??'no'} code projections`,async()=>{
 const code=visibility?{code:'0123#',visibility}:null;await seedRequest({code});const before=(await reqRef().get()).data();const body=decision();const result=await call(`requests/${ID}/decision`,{method:'POST',body});assert.equal(result.status,200);assert.equal(result.data.status,'approved');
 const data=(await reqRef().get()).data();assert.deepEqual((await placeRef().get()).data(),before.listing);assert.equal(data.revision,2);assert.equal(data.codeDraft,null);assert.equal(data.codeFingerprint,codeFingerprint(code));assert.equal(data.reviewedAt.toMillis(),clock);assert.deepEqual(Object.keys(data).sort(),['schemaVersion','status','revision','submittedAt','listing','codeDraft','reviewedAt','reason','codeFingerprint'].sort());assert.deepEqual((await receiptRef().get()).data(),{ownerUID:owner.uid,submittedAt:OLD});assert.deepEqual((await summaryRef().get()).data(),{ratingCount:0,ratingSum:0,updatedAt:Timestamp.fromMillis(clock)});
 const own=(await db.doc(`users/${owner.uid}/restroomReadyPasscodes/${ID}`).get()).data();const reservations=await db.collection('restroomPasscodeOwners').get();const publics=await db.collection('restroomPasscodeReports').doc(ID).collection('reports').get();const saved=(await db.doc(`users/${owner.uid}/restroomReadySaved/${ID}`).get()).data();
 if(!code){assert.equal(own,undefined);assert.equal(reservations.size,0);assert.equal(publics.size,0);assert.equal(saved,undefined);}else{assert.equal(reservations.size,1);const report=reservations.docs[0];assert.deepEqual(report.data(),{ownerUID:owner.uid,placeID:ID,createdAt:OLD});assert.deepEqual(own,{placeID:ID,reportID:report.id,code:code.code,visibility,createdAt:OLD,codeUpdatedAt:OLD,lastVerifiedAt:null});if(visibility==='private'){assert.equal(publics.size,0);assert.deepEqual(saved,{placeID:ID,savedAt:Timestamp.fromMillis(clock)});}else{assert.equal(saved,undefined);assert.equal(publics.size,1);assert.equal(publics.docs[0].id,report.id);assert.deepEqual(publics.docs[0].data(),{placeID:ID,code:code.code,codeUpdatedAt:OLD,lastVerifiedAt:null});}}
 assert.deepEqual((await call(`requests/${ID}/decision`,{method:'POST',body})).data,result.data);assert.equal((await db.collection('restroomModerationActions').get()).size,1);await assertNoSensitiveReceipt((await db.collection('restroomModerationActions').doc(body.actionId).get()).data(),code?.code);
});
test('denial publishes nothing, scrubs raw code and is idempotent after owner Auth deletion',async()=>{
 await seedRequest({code:{code:'0123#',visibility:'private'}});const body=decision('deny');const result=await call(`requests/${ID}/decision`,{method:'POST',body});assert.equal(result.status,200);assert.equal(result.data.status,'denied');await assertNoPublication();const data=(await reqRef().get()).data();assert.equal(data.codeDraft,null);assert.equal(data.reason,'duplicate');assert.match(data.codeFingerprint,/^[0-9a-f]{64}$/);await auth.deleteUser(owner.uid);assert.deepEqual((await call(`requests/${ID}/decision`,{method:'POST',body})).data,result.data);
});
test('same action cannot be reused for a changed decision, revision, target or moderator',async()=>{
 await seedRequest();await seedRequest({id:SECOND});const body=decision();assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body})).status,200);
 for(const next of [{...body,decision:'deny',reason:'duplicate'},{...body,revision:2}])assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body:next})).status,409);
 assert.equal((await call(`requests/${SECOND}/decision`,{method:'POST',body})).status,409);
 await writeFile(rosterPath,JSON.stringify({version:1,uids:[moderator.uid,secondModerator.uid]}));assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body,token:secondModerator.token})).status,409);assert.equal((await reqRef(SECOND).get()).data().status,'pending');
});
test('parallel same action retries commit once and competing decisions return a single winner',async()=>{
 await seedRequest({code:{code:'0123#',visibility:'private'}});const body=decision();const results=await Promise.all([call(`requests/${ID}/decision`,{method:'POST',body}),call(`requests/${ID}/decision`,{method:'POST',body})]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results[0].data,results[1].data);assert.equal((await db.collection('restroomPasscodeOwners').get()).size,1);
 await seedRequest({id:SECOND});const race=await Promise.all([call(`requests/${SECOND}/decision`,{method:'POST',body:decision()}),call(`requests/${SECOND}/decision`,{method:'POST',body:decision('deny')})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);const terminal=(await reqRef(SECOND).get()).data();assert.equal((await placeRef(SECOND).get()).exists,terminal.status==='approved');assert.equal((await db.collection('restroomModerationActions').get()).size,2);
});
for(const blocked of ['owner-lock','owner-disabled','owner-missing','moderator-lock','existing-listing','existing-summary','bad-reservation'])test(`approval fails closed for ${blocked} without a partial public projection`,async()=>{
 await seedRequest();if(blocked==='owner-lock')await db.doc(`accountDeletionLocks/${owner.uid}`).set({phase:'pending',policyVersion:DELETION_POLICY_VERSION});if(blocked==='owner-disabled')await auth.updateUser(owner.uid,{disabled:true});if(blocked==='owner-missing')await auth.deleteUser(owner.uid);if(blocked==='moderator-lock')await db.doc(`accountDeletionLocks/${moderator.uid}`).set({phase:'pending',policyVersion:DELETION_POLICY_VERSION});if(blocked==='existing-listing')await placeRef().set(list());if(blocked==='existing-summary')await summaryRef().set({ratingCount:0,ratingSum:0,updatedAt:OLD});if(blocked==='bad-reservation')await receiptRef().update({submittedAt:new Timestamp(OLD.seconds,OLD.nanoseconds+1000)});
 const result=await call(`requests/${ID}/decision`,{method:'POST',body:decision()});assert.ok([403,409].includes(result.status),JSON.stringify(result));assert.equal((await reqRef().get()).data().status,'pending');assert.equal((await db.collection('restroomModerationActions').get()).size,0);assert.equal((await db.collection('restroomPasscodeOwners').get()).size,0);
 if(blocked!=='existing-listing')assert.equal((await placeRef().get()).exists,false);if(blocked!=='existing-summary')assert.equal((await summaryRef().get()).exists,false);
});
test('deletion lock created after owner Auth lookup still fences the actual approval transaction',async()=>{
 await seedRequest();const live={verifyIdToken:auth.verifyIdToken.bind(auth),getUser:async uid=>{const user=await auth.getUser(uid);if(uid===owner.uid)await db.doc(`accountDeletionLocks/${uid}`).set({phase:'pending',policyVersion:DELETION_POLICY_VERSION});return user;}};service=createModerationService({auth:live,db,roster,now:()=>clock});const result=await call(`requests/${ID}/decision`,{method:'POST',body:decision()});assert.equal(result.status,409);await assertNoPublication();
});
for(const visibility of ['private','public'])test(`approved ${visibility} code/request remains compatible with actual policy4 account cleanup`,async()=>{
 await seedRequest({code:{code:'0123#',visibility}});const body=decision();assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body})).status,200);const listing=(await placeRef().get()).data();await summaryRef().update({ratingCount:1,ratingSum:4.5});await summaryRef().collection('ratings').doc(owner.uid).set({stars:4.5,updatedAt:OLD});const summary=(await summaryRef().get()).data();await db.doc(`accountDeletionLocks/${owner.uid}`).set({phase:'pending',policyVersion:DELETION_POLICY_VERSION});await cleanupAccount(db,owner.uid,await leaseFor(owner.uid));
 assert.deepEqual((await placeRef().get()).data(),listing);assert.deepEqual((await summaryRef().get()).data(),summary);assert.equal((await summaryRef().collection('ratings').doc(owner.uid).get()).exists,false);assert.equal((await summaryRef().collection('anonymousRatings').get()).docs[0].data().stars,4.5);assert.equal((await reqRef().get()).exists,false);assert.equal((await receiptRef().get()).exists,false);assert.equal((await db.collection('restroomPasscodeOwners').get()).size,0);assert.equal((await db.collection('restroomPasscodeReports').doc(ID).collection('reports').get()).size,0);assert.equal((await db.doc(`users/${owner.uid}/restroomReadyPasscodes/${ID}`).get()).exists,false);assert.equal((await db.doc(`users/${owner.uid}/restroomReadySaved/${ID}`).get()).exists,false);await auth.deleteUser(owner.uid);assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body})).status,200);
});
test('request pagination uses opaque actor/status-bound cursors and never returns private code or requester identity',async()=>{
 for(const [id,seconds]of [[ID,0],[SECOND,1],[THIRD,2]])await seedRequest({id,code:{code:'0123#',visibility:'private'},at:new Timestamp(OLD.seconds+seconds,OLD.nanoseconds)});
 const first=await call('requests?status=pending&limit=1');assert.equal(first.status,200);assert.equal(first.data.items.length,1);assert.match(first.data.nextCursor,/^[A-Za-z0-9_-]{32}$/);await assertNoSensitiveReceipt(first.data,'0123#');const second=await call(`requests?status=pending&limit=1&cursor=${first.data.nextCursor}`);assert.equal(second.status,200);assert.notEqual(second.data.items[0].id,first.data.items[0].id);
 assert.equal((await call(`requests?status=approved&cursor=${first.data.nextCursor}`)).status,410);await writeFile(rosterPath,JSON.stringify({version:1,uids:[moderator.uid,secondModerator.uid]}));assert.equal((await call(`requests?cursor=${first.data.nextCursor}`,{token:secondModerator.token})).status,410);clock+=16*60*1000;assert.equal((await call(`requests?cursor=${first.data.nextCursor}`)).status,410);
});
test('mixed reports collection-group pagination returns each exact visitor namespace once and excludes codes/private collisions',async()=>{
 await seedComment('public-note');await seedComment('unified-visit',{id:NOTE,at:new Timestamp(OLD.seconds+1,0)});await db.doc(`restroomPasscodeReports/${PLACE}/reports/${CODE}`).set({...noteData('unified-visit',{at:new Timestamp(OLD.seconds+10,0)}),code:'PRIVATE-NAMESPACE-CODE'});await db.doc(`users/${owner.uid}/reports/${CODE}`).set(noteData('unified-visit',{at:new Timestamp(OLD.seconds+9,0)}));await db.doc(`users/${owner.uid}/notes/${CODE}`).set(noteData('public-note',{at:new Timestamp(OLD.seconds+8,0)}));
 const results=[];let cursor=null;for(let page=0;page<10;page++){const result=await call('comments?limit=1'+(cursor?'&cursor='+cursor:''));assert.equal(result.status,200);results.push(...result.data.items);cursor=result.data.nextCursor;if(!cursor)break;assert.match(cursor,/^[A-Za-z0-9_-]{32}$/);assert.equal(JSON.stringify(result.data).includes('PRIVATE-NAMESPACE-CODE'),false);}
 assert.equal(cursor,null);assert.deepEqual(results.map(r=>r.kind).sort(),['public-note','unified-visit']);assert.equal(new Set(results.map(r=>r.kind+':'+r.id)).size,2);for(const row of results){assert.equal(row.authorLabel,'Anonymous');assert.match(row.revision,/^\d+:\d+$/);assert.equal(row.id,NOTE);}
});
for(const kind of ['public-note','unified-visit'])for(const structured of [false,true])test(`${kind} removal ${structured?'redacts only text':'deletes the exact public/private pair'} and writes a replay marker`,async()=>{
 const before=await seedComment(kind,{structured});const receipt=(await ownRef(kind).get()).data();const result=await removeComment(kind);assert.equal(result.status,200);assert.equal(result.data.mode,structured?'redacted':'deleted');const publicAfter=await publicRef(kind).get(),privateAfter=await ownRef(kind).get();
 if(structured){assert.deepEqual(publicAfter.data(),{...before.data(),[pathFor(kind).text]:''});assert.deepEqual(privateAfter.data(),receipt);}else{assert.equal(publicAfter.exists,false);assert.equal(privateAfter.exists,false);}
 const marker=(await markerRef(kind).get()).data();assert.deepEqual(Object.keys(marker).sort(),['kind','placeID','recordID','reason','removedAt'].sort());await assertNoSensitiveReceipt(marker);const replay=await call(`comments/${kind}/${PLACE}/${kind==='public-note'?NOTE:VISIT}/remove`,{method:'POST',body:result.body});assert.deepEqual(replay.data,result.data);assert.equal((await db.collection('restroomModerationActions').get()).size,1);
 const client=environment.authenticatedContext(owner.uid,{firebase:{sign_in_provider:'google.com'}}).firestore(),p=pathFor(kind),id=kind==='public-note'?NOTE:VISIT;
 if(structured){const deletion=writeBatch(client);deletion.delete(doc(client,p.root,PLACE,p.group,id));deletion.delete(doc(client,'users',owner.uid,p.receipt,id));await deletion.commit();}
 const batch=writeBatch(client);batch.set(doc(client,p.root,PLACE,p.group,id),{...before.data(),observedAt:new ClientTimestamp(before.get('observedAt').seconds,before.get('observedAt').nanoseconds),submittedAt:serverTimestamp()});batch.set(doc(client,'users',owner.uid,p.receipt,id),{placeID:PLACE,submittedAt:serverTimestamp(),...(kind==='unified-visit'?{codeReportID:null}:{})});await assertFails(batch.commit());assert.equal((await markerRef(kind).get()).exists,true);
});
for(const corrupt of ['missing-receipt','ambiguous-receipt','receipt-date','receipt-extra-field','too-many-candidates'])test(`comment removal fails closed on ${corrupt} ownership without modifying text or markers`,async()=>{
 await seedComment('public-note');if(corrupt==='missing-receipt')await ownRef('public-note').delete();if(corrupt==='ambiguous-receipt')await ownRef('public-note',NOTE,other.uid).set({placeID:PLACE,submittedAt:OLD});if(corrupt==='receipt-date')await ownRef('public-note').update({submittedAt:OBSERVED});if(corrupt==='receipt-extra-field')await ownRef('public-note').update({extra:'bad'});if(corrupt==='too-many-candidates'){const batch=db.batch();for(let i=0;i<51;i++)batch.set(db.doc(`users/${other.uid}/restroomReadyPublicNoteReceipts/${String(i).padStart(20,'X')}`),{placeID:PLACE,submittedAt:OLD});await batch.commit();}
 const result=await removeComment('public-note');assert.ok([400,503].includes(result.status),JSON.stringify(result));assert.equal((await publicRef('public-note').get()).data().body,'Synthetic public comment.');assert.equal((await markerRef('public-note').get()).exists,false);assert.equal((await db.collection('restroomModerationActions').get()).size,0);
});
test('changed updateTime, fresh duplicate action and namespace confusion cannot remove a comment',async()=>{
 const before=await seedComment('public-note');await publicRef('public-note').update({body:'Changed synthetic text.'});const stale=await removeComment('public-note',{revision:revision(before.updateTime)});assert.equal(stale.status,409);assert.equal((await publicRef('public-note').get()).data().body,'Changed synthetic text.');const result=await removeComment('public-note');assert.equal(result.status,200);const again=await call(`comments/public-note/${PLACE}/${NOTE}/remove`,{method:'POST',body:{...result.body,actionId:randomUUID()}});assert.equal(again.status,404);const wrong=await call(`comments/unified-visit/${PLACE}/${NOTE}/remove`,{method:'POST',body:result.body});assert.equal(wrong.status,409);
});

for(const issue of ['noon-observation','nanosecond-observation','future-review-clock','extra-field','missing-code-requirement'])test(`malformed request ${issue} cannot publish an unreadable legacy projection`,async()=>{
 const listing={},options={};if(issue==='noon-observation')listing.observedOn=Timestamp.fromMillis(Date.UTC(2026,8,1,12));if(issue==='nanosecond-observation')listing.observedOn=new Timestamp(Math.floor(Date.UTC(2026,8,1)/1000),1000);if(issue==='extra-field')listing.ownerUID='must-never-publish';if(issue==='missing-code-requirement'){options.code={code:'0123#',visibility:'private'};listing.passcodeRequired='unknown';}await seedRequest({...options,listing});if(issue==='future-review-clock')clock=OLD.toMillis()-1000;
 const result=await call(`requests/${ID}/decision`,{method:'POST',body:decision()});assert.ok([400,409,503].includes(result.status),JSON.stringify(result));await assertNoPublication();assert.equal((await reqRef().get()).data().status,'pending');assert.equal((await db.collection('restroomModerationActions').get()).size,0);
});
for(const kind of ['public-note','unified-visit'])for(const issue of ['extra-field','unknown-enum','missing-field','nanosecond-reversed'])test(`${kind} malformed ${issue} is absent from feed and cannot be moderated as valid content`,async()=>{
 await seedComment(kind);const data=(await publicRef(kind).get()).data();if(issue==='extra-field')data.extra='private-metadata';if(issue==='unknown-enum')data.soap=null;if(issue==='missing-field')delete data.stairs;if(issue==='nanosecond-reversed')data.observedAt=new Timestamp(OLD.seconds,OLD.nanoseconds+1000);await publicRef(kind).set(data);assert.deepEqual((await call('comments')).data.items,[]);const result=await removeComment(kind);assert.equal(result.status,404);assert.equal((await publicRef(kind).get()).exists,true);assert.equal((await markerRef(kind).get()).exists,false);
});
test('concurrent duplicate removals return one committed result and preserve unrelated same-ID namespace',async()=>{
 await seedComment('public-note');await seedComment('unified-visit',{id:NOTE});const snapshot=await publicRef('public-note').get(),body={revision:revision(snapshot.updateTime),reason:'spam',actionId:randomUUID()};const path=`comments/public-note/${PLACE}/${NOTE}/remove`;const results=await Promise.all([call(path,{method:'POST',body}),call(path,{method:'POST',body})]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results[0].data,results[1].data);assert.equal((await db.collection('restroomModerationActions').get()).size,1);assert.equal((await publicRef('unified-visit',NOTE).get()).data().comment,'Synthetic public comment.');assert.equal((await ownRef('unified-visit',NOTE).get()).exists,true);
});
test('revoking roster or locking moderator after sign-in prevents later actions without changing a request',async()=>{
 await seedRequest();assert.equal((await call('session')).status,200);await writeFile(rosterPath,JSON.stringify({version:1,uids:[]}));assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body:decision()})).status,403);await writeFile(rosterPath,JSON.stringify({version:1,uids:[moderator.uid]}));await db.doc(`accountDeletionLocks/${moderator.uid}`).set({phase:'pending',policyVersion:DELETION_POLICY_VERSION});assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body:decision()})).status,403);await assertNoPublication();
});

test('non-Google sign-in, unverified Google claims, and recycled bootstrap email cannot become moderator',async()=>{
 await call('session');const rejected=await google('backend-unverified','unverified@example.test',false);assert.equal((await call('session',{token:rejected.token})).status,401);
 const claims=JSON.parse(Buffer.from(moderator.token.split('.')[1],'base64url').toString());claims.firebase.sign_in_provider='password';const fake=`${moderator.token.split('.')[0]}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;assert.equal((await call('session',{token:fake})).status,401);
 const original=moderator.uid;await auth.deleteUser(original);const replacement=await google('backend-recycled-moderator',moderator.email);assert.notEqual(replacement.uid,original);assert.equal((await call('session',{token:replacement.token})).status,403);assert.deepEqual(JSON.parse(await readFile(rosterPath,'utf8')).uids,[original]);
});

const contentReport=(kind='public-note',extra={})=>({kind,placeID:PLACE,recordID:kind==='public-note'?NOTE:VISIT,postedAt:revision(OLD),reason:'harassment',actionId:randomUUID(),...extra});
async function report(kind='public-note',extra={}){const body=contentReport(kind,extra);return {...await call('reports',{method:'POST',token:other.token,body}),body};}
async function resolveSafety(id,decision='remove',extra={}){const r=await db.doc(`restroomContentReports/${id}`).get();const body={decision,revision:revision(r.updateTime),reason:'harassment',actionId:randomUUID(),...extra};return {...await call(`reports/${id}/resolve`,{method:'POST',body}),body};}
for(const kind of ['public-note','unified-visit'])test(`private ${kind} report pins target and exact receipt, never copies author/body, with repeat/concurrent safety`,async()=>{
 await seedComment(kind);const first=await report(kind);assert.equal(first.status,200);assert.deepEqual(first.data,{status:'received',reportID:first.body.actionId});
 const stored=(await db.doc(`restroomContentReports/${first.data.reportID}`).get()).data();assert.equal(stored.reporterUID,other.uid);assert.equal(stored.status,'pending');assert.equal(Object.hasOwn(stored,'body'),false);assert.equal(Object.hasOwn(stored,'text'),false);assert.equal(JSON.stringify(stored).includes(owner.uid),false);
 assert.deepEqual((await call('reports',{method:'POST',token:other.token,body:first.body})).data,first.data);
 assert.equal((await call('reports',{method:'POST',token:other.token,body:{...first.body,reason:'spam'}})).status,409);
 assert.equal((await call('reports',{method:'POST',token:owner.token,body:first.body})).status,409);
 const q=await call('reports');assert.equal(q.status,200);assert.equal(q.data.items.length,1);assert.equal(JSON.stringify(q.data).includes(other.uid),false);assert.equal(q.data.items[0].text,'Synthetic public comment.');
 assert.equal((await call('reports',{token:owner.token})).status,403);
 for(const context of [environment.unauthenticatedContext(),environment.authenticatedContext('reader',{admin:true})])for(const path of [`restroomContentReports/${first.data.reportID}`,`restroomContentReportLimits/${other.uid}`,`restroomContributorSuspensions/${owner.uid}`])await assertFails(getDocFromServer(doc(context.firestore(),path)));
});
test('new reports require capable cleanup, current public target and exact version; no partial quota/report on failure',async()=>{
 await seedComment('public-note');const body=contentReport();const incapable=createModerationService({auth,db,roster,now:()=>clock});await assert.rejects(incapable.reportContent(other.token,body),e=>e.code==='moderation_unavailable');
 assert.equal((await call('reports',{method:'POST',token:other.token,body:{...body,postedAt:'1:0'}})).status,409);
 assert.equal((await call('reports',{method:'POST',token:other.token,body:{...body,body:'not accepted'}})).status,400);
 assert.equal((await db.collection('restroomContentReports').get()).size,0);assert.equal((await db.collection('restroomContentReportLimits').get()).size,0);
});
test('reports are bounded per enabled signed-in account, with successful retries not consuming quota',async()=>{
 await seedComment('public-note');const first=await report();for(let i=1;i<20;i++)assert.equal((await report()).status,200);
 assert.equal((await report()).status,429);assert.equal((await call('reports',{method:'POST',token:other.token,body:first.body})).status,200);
 clock+=3600001;assert.equal((await report()).status,200);
});
for(const kind of ['public-note','unified-visit'])for(const structured of [false,true])test(`${kind} resolve removes text and suspends only pinned receipt owner; repeat is safe (${structured})`,async()=>{
 await seedComment(kind,{structured});const first=await report(kind);const result=await resolveSafety(first.data.reportID,'remove-and-suspend');assert.equal(result.status,200);assert.equal(result.data.mode,structured?'redacted':'deleted');
 const suspensions=await db.collection('restroomContributorSuspensions').get();assert.equal(suspensions.size,1);assert.equal(suspensions.docs[0].id,owner.uid);assert.equal(JSON.stringify(result.data).includes(owner.uid),false);
 assert.equal((await publicRef(kind).get()).exists,structured);if(structured)assert.equal((await publicRef(kind).get()).get(pathFor(kind).text),'');
 assert.deepEqual((await call(`reports/${first.data.reportID}/resolve`,{method:'POST',body:result.body})).data,result.data);
 assert.equal((await call(`reports/${first.data.reportID}/resolve`,{method:'POST',body:{...result.body,decision:'dismiss'}})).status,409);
});
test('changed comment content, missing or ambiguous ownership and mismatched report version never suspend an inferred user',async()=>{
 await seedComment('public-note');let r=await report();await publicRef('public-note').update({body:'Changed comment.'});assert.equal((await resolveSafety(r.data.reportID,'remove-and-suspend')).status,409);assert.equal((await db.collection('restroomContributorSuspensions').get()).size,0);
 await ownRef('public-note').delete();r=await report();assert.equal((await resolveSafety(r.data.reportID,'remove-and-suspend')).status,503);assert.equal((await publicRef('public-note').get()).exists,true);
});
for(const kind of ['source-comment','research-comment'])test(`${kind} uses exact UTF-8 content hash and removes only the selected imported text without author suspension`,async()=>{
 const text='Imported synthetic comment.',id='imported-original';const ref=kind==='source-comment'?db.doc(`restroomSourceComments/${PLACE}/comments/${id}`):db.doc(`restroomResearchProfiles/${PLACE}`);
 await ref.set(kind==='source-comment'?{text,placeID:PLACE}:{comments:[{id,text},{id:'keep-me',text:'Unrelated text.'}],facts:[{untouched:true}]});
 const body={kind,placeID:PLACE,recordID:id,contentHash:createHash('sha256').update(text,'utf8').digest('hex'),reason:'spam',actionId:randomUUID()};
 assert.equal((await call('reports',{method:'POST',token:other.token,body:{...body,contentHash:'0'.repeat(64)}})).status,409);
 const first=await call('reports',{method:'POST',token:other.token,body});assert.equal(first.status,200);assert.equal((await resolveSafety(first.data.reportID,'remove-and-suspend')).status,400);assert.equal((await resolveSafety(first.data.reportID,'remove')).status,200);
 if(kind==='source-comment')assert.equal((await ref.get()).exists,false);else assert.deepEqual((await ref.get()).data(),{comments:[{id:'keep-me',text:'Unrelated text.'}],facts:[{untouched:true}]});assert.equal((await db.collection('restroomContributorSuspensions').get()).size,0);
});
test('dismiss remains possible for unavailable target, records reviewed time and does not mutate venue/comment content',async()=>{
 await seedComment('public-note');const r=await report();await publicRef('public-note').delete();const result=await resolveSafety(r.data.reportID,'dismiss');assert.equal(result.status,200);assert.equal((await db.doc(`restroomContentReports/${r.data.reportID}`).get()).get('decision'),'dismiss');assert.equal((await db.collection('restroomContributorSuspensions').get()).size,0);
});
test('policy5 account deletion unlinks own safety reports and clears rate/suspension while preserving other reporters and case status',async()=>{
 await seedComment('public-note');const first=await report();await db.doc(`restroomContentReports/${randomUUID()}`).set({reporterUID:owner.uid,status:'pending',fingerprint:'other-owner'});await db.doc(`restroomContributorSuspensions/${other.uid}`).set({reason:'spam'});await db.doc(`accountDeletionLocks/${other.uid}`).set({phase:'pending',policyVersion:DELETION_POLICY_VERSION});
 await cleanupAccount(db,other.uid,await leaseFor(other.uid));const data=(await db.doc(`restroomContentReports/${first.data.reportID}`).get()).data();assert.equal(data.reporterUID,null);assert.equal(data.fingerprint,null);assert.equal(data.status,'pending');assert.equal((await db.doc(`restroomContentReportLimits/${other.uid}`).get()).exists,false);assert.equal((await db.doc(`restroomContributorSuspensions/${other.uid}`).get()).exists,false);assert.equal((await db.collection('restroomContentReports').where('reporterUID','==',owner.uid).get()).size,1);
});

test('imported content hashes use exact raw UTF-8 including whitespace and composed accents',async()=>{
 const id='unicode-original',text='\n Café observation. \n';await db.doc(`restroomSourceComments/${PLACE}/comments/${id}`).set({text});
 const base={kind:'source-comment',placeID:PLACE,recordID:id,reason:'other',actionId:randomUUID()};const hash=t=>createHash('sha256').update(t,'utf8').digest('hex');
 assert.equal((await call('reports',{method:'POST',token:other.token,body:{...base,contentHash:hash(text.trim())}})).status,409);
 const r=await call('reports',{method:'POST',token:other.token,body:{...base,contentHash:hash(text)}});assert.equal(r.status,200);assert.equal((await resolveSafety(r.data.reportID)).status,200);
});
test('contribution status exposes only the current account projection; suspended users can still privately report abuse',async()=>{
 assert.deepEqual((await call('contribution-status',{token:other.token})).data,{status:'allowed'});await db.doc(`restroomContributorSuspensions/${other.uid}`).set({moderatorUID:moderator.uid,reason:'harassment'});assert.deepEqual((await call('contribution-status',{token:other.token})).data,{status:'suspended'});assert.equal((await call('contribution-status?status=pending',{token:other.token})).status,400);assert.equal((await call('contribution-status',{token:null})).status,401);await seedComment('public-note');assert.equal((await report()).status,200);
});

test('approval refuses filtered listing text or suspended submitter without partial publication',async()=>{
 await seedRequest({listing:{notes:'FUCK you'}});assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body:decision()})).status,400);assert.equal((await placeRef().get()).exists,false);await reqRef().update({'listing.notes':'Corrected synthetic note.'});await db.doc(`restroomContributorSuspensions/${owner.uid}`).set({reason:'harassment'});assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body:decision()})).status,409);assert.equal((await placeRef().get()).exists,false);
});

for(const comment of ['', 'Ordinary public text.'])test(`explicit moderation anonymizes named unified attribution with structured facts (${comment?'comment':'name-only'})`,async()=>{
 await seedComment('unified-visit',{structured:true,text:comment,anonymous:false,authorName:'FUCK YOU'});const r=await report('unified-visit');assert.equal(r.status,200);const result=await resolveSafety(r.data.reportID,'remove-and-suspend');assert.equal(result.status,200);const data=(await publicRef('unified-visit').get()).data();assert.equal(data.comment,'');assert.equal(data.anonymous,true);assert.equal(data.authorName,null);assert.equal(data.soap,'yes');assert.ok(data.submittedAt.isEqual(OLD));assert.equal((await ownRef('unified-visit').get()).exists,true);
});
test('named attribution changes invalidate an earlier private report pin even if comment and posted timestamp remain unchanged',async()=>{
 await seedComment('unified-visit',{structured:true,anonymous:false,authorName:'First Name'});const r=await report('unified-visit');await publicRef('unified-visit').update({authorName:'Changed Name'});assert.equal((await resolveSafety(r.data.reportID,'remove-and-suspend')).status,409);assert.equal((await db.collection('restroomContributorSuspensions').get()).size,0);
});
test('new suspend writes require cleanup capability while exact completed action retries remain confirmable',async()=>{
 await seedComment('public-note');const r=await report();const snap=await db.doc(`restroomContentReports/${r.data.reportID}`).get();const body={decision:'remove-and-suspend',revision:revision(snap.updateTime),reason:'harassment',actionId:randomUUID()};const incapable=createModerationService({auth,db,roster,now:()=>clock});await assert.rejects(incapable.resolveReport(moderator.token,r.data.reportID,body),e=>e.code==='moderation_unavailable');const done=await service.resolveReport(moderator.token,r.data.reportID,body);assert.deepEqual(await incapable.resolveReport(moderator.token,r.data.reportID,body),done);
});
for(const kind of ['public-note','unified-visit'])test(`malformed ${kind} owner receipt cannot suspend or partially redact`,async()=>{
 await seedComment(kind,{receipt:kind==='public-note'?{extra:'not allowed'}:{codeReportID:'not-valid'}});const r=await report(kind);assert.equal((await resolveSafety(r.data.reportID,'remove-and-suspend')).status,503);assert.equal((await db.collection('restroomContributorSuspensions').get()).size,0);assert.equal((await publicRef(kind).get()).get(pathFor(kind).text),'Synthetic public comment.');
});

const codeConfig=kind=>kind==='legacy-code'?{root:'restroomPasscodeReports',owners:'restroomPasscodeOwners',own:'restroomReadyPasscodes',marker:'legacyCodes'}:{root:'restroomPasscodeReportsV2',owners:'restroomPasscodeV2Owners',own:'restroomReadyPasscodesV2',marker:'v2Codes'};
async function seedPublicCode(kind,{owned=true}={}){const c=codeConfig(kind),id=CODE;const target=db.doc(`${c.root}/${PLACE}/reports/${id}`),privateRef=db.doc(`users/${owner.uid}/${c.own}/${kind==='legacy-code'?PLACE:id}`);const b=db.batch();b.set(target,{placeID:PLACE,code:'PUBLIC-TEST-CODE',codeUpdatedAt:OLD,...(kind==='legacy-code'?{lastVerifiedAt:null}:{})});if(owned){b.set(db.doc(`${c.owners}/${id}`),{ownerUID:owner.uid,placeID:PLACE,createdAt:OLD});b.set(privateRef,{placeID:PLACE,code:'PUBLIC-TEST-CODE',visibility:'public',createdAt:OLD,codeUpdatedAt:OLD,lastVerifiedAt:null,...(kind==='legacy-code'?{reportID:id}:{})});}return b.commit().then(()=>({target,privateRef,id,c}));}
for(const kind of ['legacy-code','v2-code']){
 test(`${kind} public report pins exact version, removes only public projection and retains private code/reservation/Saved`,async()=>{
  const f=await seedPublicCode(kind);await db.doc(`users/${owner.uid}/restroomReadySaved/${PLACE}`).set({placeID:PLACE,savedAt:OLD});const before=await f.privateRef.get(),reserveBefore=await db.doc(`${f.c.owners}/${CODE}`).get(),savedBefore=await db.doc(`users/${owner.uid}/restroomReadySaved/${PLACE}`).get();const r=await report(kind,{recordID:CODE});assert.equal(r.status,200);const result=await resolveSafety(r.data.reportID,'remove-and-suspend');assert.equal(result.status,200);assert.equal((await f.target.get()).exists,false);assert.deepEqual((await f.privateRef.get()).data(),before.data());assert.ok((await f.privateRef.get()).updateTime.isEqual(before.updateTime));assert.deepEqual((await db.doc(`${f.c.owners}/${CODE}`).get()).data(),reserveBefore.data());assert.deepEqual((await db.doc(`users/${owner.uid}/restroomReadySaved/${PLACE}`).get()).data(),savedBefore.data());const marker=(await db.doc(`restroomModerationRemovals/${PLACE}/${f.c.marker}/${CODE}`).get()).data();assert.ok(marker.codeUpdatedAt.isEqual(OLD));assert.equal(JSON.stringify(marker).includes('PUBLIC-TEST-CODE'),false);assert.equal(JSON.stringify(marker).includes(owner.uid),false);assert.equal((await db.doc(`restroomContributorSuspensions/${owner.uid}`).get()).exists,true);
 });
 test(`${kind} ownerless imported public code can be removed, never gets an inferred suspension owner`,async()=>{
  const f=await seedPublicCode(kind,{owned:false});const r=await report(kind,{recordID:CODE});assert.equal(r.status,200);assert.equal((await call('reports')).data.items[0].canSuspend,false);assert.equal((await resolveSafety(r.data.reportID,'remove-and-suspend')).status,503);assert.equal((await resolveSafety(r.data.reportID,'remove')).status,200);assert.equal((await f.target.get()).exists,false);assert.equal((await db.collection('restroomContributorSuspensions').get()).size,0);
 });
 test(`${kind} changed version with identical visible code invalidates old report availability and cannot remove latest version`,async()=>{
  const f=await seedPublicCode(kind);const r=await report(kind,{recordID:CODE});await f.target.update({codeUpdatedAt:new Timestamp(OLD.seconds+1,OLD.nanoseconds)});assert.equal((await call('reports')).data.items[0].available,false);assert.equal((await resolveSafety(r.data.reportID,'remove')).status,409);assert.equal((await f.target.get()).exists,true);
 });
}
test('a pending public code that fails filtering cannot publish through moderator approval; private code remains valid',async()=>{
 await seedRequest({code:{code:'FUCK',visibility:'public'}});assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body:decision()})).status,400);assert.equal((await placeRef().get()).exists,false);await reqRef().update({'codeDraft.visibility':'private'});assert.equal((await call(`requests/${ID}/decision`,{method:'POST',body:decision()})).status,200);assert.equal((await db.doc(`users/${owner.uid}/restroomReadyPasscodes/${ID}`).get()).get('code'),'FUCK');
});
