import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../scripts/local-store.mjs';
import {signupResponse,validateSignup} from '../worker/waitlist.mjs';
import {confirmationClientKey,confirmationDispatchReady,drainConfirmations,confirmationDispatchResponse,startConfirmationDispatcher,SITES_CONFIRMATION_DISPATCH_URL} from '../worker/confirmation-dispatch.mjs';

const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_API_TOKEN:'fake-test-token-only-1234567890',WAITLIST_EMAIL_FROM:'welcome@nyc.imfinethanku.me',WAITLIST_DISPATCH_SECRET:'b'.repeat(64)};
const accepted={outcome:'accepted',reason:'queued',ambiguous:false};
const req=(authorization,method='POST')=>new Request('https://example.test/api/waitlist-confirmations/dispatch',{method,headers:authorization?{Authorization:authorization}:{}});

test('confirmation client key is a stable secret-keyed digest and missing settings disable it',async()=>{
 assert.equal(confirmationDispatchReady(env),true);
 const key=await confirmationClientKey('192.0.2.1',env);
 assert.match(key,/^[a-f0-9]{64}$/);
 assert.equal(await confirmationClientKey('192.0.2.1',env),key);
 assert.notEqual(await confirmationClientKey('192.0.2.2',env),key);
 assert.notEqual(await confirmationClientKey('192.0.2.1',{...env,WAITLIST_DISPATCH_SECRET:'c'.repeat(64)}),key);
 assert.equal(await confirmationClientKey('192.0.2.1',{}),'');
});

test('unconfigured drain touches no store or sender',async()=>{
 const result=await drainConfirmations({claim(){assert.fail('Must not claim');}},{},{send(){assert.fail('Must not send');}});
 assert.equal(result.processed,0);
});

test('one drain is capped at two claims and reports provider acceptance without recipient details',async()=>{
 let claims=0,sends=0,completes=0;
 const store={async claim(){return {email:'private@example.test',attempts:1,lease_token:'lease-'+(++claims)};},async complete(job,result){assert.equal(result,accepted);completes++;return true;}};
 const result=await drainConfirmations(store,env,{limit:999,send:async()=>{sends++;return accepted;}});
 assert.equal(claims,2);assert.equal(sends,2);assert.equal(completes,2);assert.equal(result.accepted,2);
 assert.equal(JSON.stringify(result).includes('private@'),false);
});

test('unexpected sender exceptions become terminal uncertainty and stale completion is not counted',async()=>{
 let available=true,completion;
 const store={async claim(){if(!available)return null;available=false;return {email:'private@example.test',attempts:1};},async complete(job,result){completion=result;return true;}};
 const result=await drainConfirmations(store,env,{send:async()=>{throw Error('private provider data');}});
 assert.deepEqual(completion,{outcome:'retry',reason:'network',ambiguous:true});assert.equal(result.uncertain,1);
 available=true;store.complete=async()=>false;
 assert.equal((await drainConfirmations(store,env,{send:async()=>accepted})).processed,0);
});

test('dispatch checks credentials and method before constructing a database store',async()=>{
 const construct=()=>{throw Error('Private database details');};
 for(const auth of [null,'Bearer wrong','Bearer '+env.WAITLIST_DISPATCH_SECRET+'x']){
  const response=await confirmationDispatchResponse(req(auth),construct,env);assert.equal(response.status,404);
 }
 const method=await confirmationDispatchResponse(req('Bearer '+env.WAITLIST_DISPATCH_SECRET,'GET'),construct,env);
 assert.equal(method.status,405);
 const unavailable=await confirmationDispatchResponse(req('Bearer '+env.WAITLIST_DISPATCH_SECRET),construct,env);
 assert.equal(unavailable.status,503);assert.equal((await unavailable.text()).includes('Private'),false);
});

test('authorized dispatch returns only uncached counts',async()=>{
 const response=await confirmationDispatchResponse(req('Bearer '+env.WAITLIST_DISPATCH_SECRET),{claim:async()=>null},env);
 assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);
 assert.deepEqual(await response.json(),{processed:0,accepted:0,pending:0,failed:0,uncertain:0});
});

test('fixed Sites bridge still runs after local store failure and refuses redirects',async()=>{
 let done;const finished=new Promise(resolve=>{done=resolve;});let seen;
 const dispatcher=startConfirmationDispatcher({claim:async()=>{throw Error('Local failure');}},env,{fetchImpl:async(url,options)=>{
  seen={url,options};done();return new Response('{}');
 }});
 try{await finished;assert.equal(seen.url,SITES_CONFIRMATION_DISPATCH_URL);assert.equal(seen.options.redirect,'error');assert.equal(seen.options.method,'POST');assert.equal(seen.options.headers.Authorization,'Bearer '+env.WAITLIST_DISPATCH_SECRET);assert.ok(seen.options.signal instanceof AbortSignal);}
 finally{dispatcher.stop();}
});

async function databaseTest(run){const directory=await mkdtemp(join(tmpdir(),'rr-confirmations-'));const filename=join(directory,'waitlist.sqlite');const store=createStore(filename);try{await run(store,filename);}finally{store.close();await rm(directory,{recursive:true,force:true});}}
const record=n=>validateSignup({email:`confirmation-${n}@example.test`,source:'home'});

test('production SQLite adapter durably enqueues, deduplicates, claims uniquely and acknowledges a saved receipt',async()=>databaseTest(async(store,filename)=>{
 const options={enqueueConfirmation:true,clientKey:'d'.repeat(64)};
 assert.deepEqual(await store.save(record(1),options),{inserted:true,queued:true});
 assert.deepEqual(await store.save(record(1),options),{inserted:false,queued:false});
 await store.save(record(2),options);
 const [first,second]=await Promise.all([store.claim(),store.claim()]);
 assert.notEqual(first.email,second.email);
 assert.equal(await store.complete(first,accepted),true);assert.equal(await store.complete(second,accepted),true);
 const reopened=createStore(filename);try{assert.equal(await reopened.claim(),null);}finally{reopened.close();}
}));

test('over-budget signup returns429 without storing its address and can succeed after the budget window',async()=>databaseTest(async(store,filename)=>{
 const options={enqueueConfirmation:true,clientKey:'e'.repeat(64),now:10_000_000};
 for(let n=0;n<5;n++)await store.save(record(n),options);
 const request=new Request('https://example.test/api/waitlist',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:record(6).email,source:'home'})});
 const response=await signupResponse(request,r=>store.save(r,options));assert.equal(response.status,429);
 const read=new DatabaseSync(filename);try{assert.equal(read.prepare('SELECT COUNT(*) AS n FROM waitlist WHERE email=?').get(record(6).email).n,0);}finally{read.close();}
 assert.deepEqual(await store.save(record(6),{...options,now:13_600_001}),{inserted:true,queued:true});
}));

test('known transient delivery failure keeps the successful signup and durable pending receipt',async()=>databaseTest(async(store,filename)=>{
 const options={enqueueConfirmation:true,clientKey:'f'.repeat(64)};
 const request=new Request('https://example.test/api/waitlist',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:record(9).email,source:'home'})});
 assert.equal((await signupResponse(request,r=>store.save(r,options))).status,200);
 const result=await drainConfirmations(store,env,{send:async()=>({outcome:'retry',reason:'provider-unavailable',ambiguous:false})});
 assert.equal(result.pending,1);
 const read=new DatabaseSync(filename);try{assert.equal(read.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n,1);assert.equal(read.prepare('SELECT status FROM waitlist_confirmation_outbox').get().status,'pending');}finally{read.close();}
}));
