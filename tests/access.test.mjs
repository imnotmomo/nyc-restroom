import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { legacyFinderAccessResponse } from '../worker/access.mjs';
import { CONFIRMATION_DISPATCH_PATH } from '../worker/confirmation-dispatch.mjs';

const legacyCookie='__Host-rr-finder-access=expired-legacy-session';
const expiredCookie=response=>{
 assert.match(response.headers.get('Set-Cookie'),/^__Host-rr-finder-access=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
};

test('finder HTML and exported React aliases do not require a shared access session',()=>{
 for(const path of ['/find','/find/','/find.html','/find.txt','/find/index.html','/find/index.txt','/find/__next.abc.txt','/%66ind/','/%2566ind/','/find%2findex.txt','/demo/','/','/api/waitlist']){
  for(const headers of [{},{Cookie:legacyCookie,RSC:'1'}]) assert.equal(legacyFinderAccessResponse(new Request(`https://example.test${path}`,{headers})),null,path);
 }
});

test('legacy access pages and exported aliases redirect to a fixed public finder destination',async()=>{
 for(const path of ['/access','/access/','/access.html','/access.txt','/access/index.html','/access/index.txt','/%61ccess/','/%2561ccess/','/access/?next=https://foreign.test']){
  for(const method of ['GET','HEAD']){
   const response=legacyFinderAccessResponse(new Request(`https://example.test${path}`,{method}));
   assert.equal(response.status,308,path);assert.equal(response.headers.get('Location'),'/find/');assert.equal(await response.text(),'');expiredCookie(response);
  }
 }
 const method=legacyFinderAccessResponse(new Request('https://example.test/access/',{method:'POST'}));
 assert.equal(method.status,405);assert.equal(method.headers.get('Allow'),'GET, HEAD');
});

test('retired access API expires its old cookie without reading or echoing submitted passcodes',async()=>{
 for(const path of ['/api/finder-access','/api/finder-access/','/api/%66inder-access']){
  for(const method of ['GET','HEAD','POST','DELETE']){
   const response=legacyFinderAccessResponse(new Request(`https://example.test${path}`,{method,headers:{Origin:'https://foreign.test'}}));
   assert.equal(response.status,410);assert.equal(response.headers.get('Location'),null);expiredCookie(response);
   if(method==='HEAD')assert.equal(await response.text(),'');else assert.match((await response.json()).error,/retired/);
  }
 }
 let reads=0;
 const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('sensitive-old-passcode'));},pull(){reads++;}});
 const request=new Request('https://example.test/api/finder-access',{method:'POST',body,duplex:'half'});
 const response=legacyFinderAccessResponse(request);
 assert.equal(request.bodyUsed,false);assert.equal(reads,0);assert.doesNotMatch(await response.text(),/sensitive-old-passcode/);
 await request.body.cancel();
});

test('standalone Worker and Node server serve public finder HTML/RSC while signup and dispatch remain protected',async()=>{
 const root=new URL('../',import.meta.url);const temporary=await mkdtemp(join(tmpdir(),'rr-public-finder-server-'));let child;
 async function copy(relative){const destination=join(temporary,relative);await mkdir(dirname(destination),{recursive:true});await copyFile(new URL(relative,root),destination);}
 async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}child=null;}
 async function start(){
  const env={...process.env,PORT:'0',PUBLIC_ORIGIN:'https://example.test',WAITLIST_DB_PATH:join(temporary,'waitlist.sqlite')};
  delete env.FINDER_ACCESS_PASSCODE;delete env.FINDER_ACCESS_SECRET;
  child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:temporary,env,stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(new Error('Local public finder fixture did not start.')),5000);child.stderr.on('data',chunk=>errors+=chunk);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local public finder fixture exited (${code}): ${errors}`));});});
 }
 try{
  for(const file of ['worker/index.mjs','worker/access.mjs','worker/waitlist.mjs','worker/confirmation-email.mjs','worker/confirmation-outbox.mjs','worker/confirmation-dispatch.mjs','scripts/serve.mjs','scripts/local-store.mjs','drizzle/0000_waitlist.sql','drizzle/0001_waitlist_confirmations.sql'])await copy(file);
  const files={'out/index.html':'public marketing','out/demo/index.html':'public demo','out/access/index.html':'legacy fallback','out/find/index.html':'public live finder','out/find/index.txt':'public nested RSC','out/find.txt':'public root RSC','.openai/hosting.json':'{}'};
  for(const[path,body]of Object.entries(files)){await mkdir(dirname(join(temporary,path)),{recursive:true});await writeFile(join(temporary,path),body);}
  const build=spawn(process.execPath,[new URL('../scripts/build-worker.mjs',import.meta.url).pathname],{cwd:temporary,stdio:'pipe'});const[buildStatus]=await once(build,'exit');assert.equal(buildStatus,0);
  const bundle=await readFile(join(temporary,'dist/server/index.js'),'utf8');assert.doesNotMatch(bundle,/FINDER_ACCESS_PASSCODE|FINDER_ACCESS_SECRET|createFinderAccessGate/);
  const base=await start();assert.equal((await fetch(base+'/api/health')).status,200);assert.equal(await(await fetch(base+'/')).text(),'public marketing');assert.equal(await(await fetch(base+'/demo/')).text(),'public demo');
  for(const path of ['/find','/find/','/%66ind/','/find/index.html']){
   for(const headers of [{},{Cookie:legacyCookie,RSC:'1'}]){
    const response=await fetch(base+path,{redirect:'manual',headers});assert.equal(response.status,200,path);assert.equal(await response.text(),'public live finder');assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
   }
  }
  for(const[path,body]of [['/find.txt','public root RSC'],['/find/index.txt','public nested RSC']]){
   const response=await fetch(base+path,{redirect:'manual',headers:{RSC:'1'}});assert.equal(response.status,200);assert.equal(await response.text(),body);
  }
  const head=await fetch(base+'/find/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const path of ['/access/','/access/index.txt']){const response=await fetch(base+path,{redirect:'manual'});assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'/find/');expiredCookie(response);}
  const retired=await fetch(base+'/api/finder-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:'obsolete-private-value'})});assert.equal(retired.status,410);assert.doesNotMatch(await retired.text(),/obsolete-private-value/);expiredCookie(retired);
  const signup=email=>({method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email,source:'home'})});
  assert.equal((await fetch(base+'/api/waitlist',signup('public-finder@example.test'))).status,200);
  const foreign=signup('foreign@example.test');foreign.headers.Origin='https://foreign.test';assert.equal((await fetch(base+'/api/waitlist',foreign)).status,403);
  const dispatch=await fetch(base+CONFIRMATION_DISPATCH_PATH,{method:'POST'});assert.equal(dispatch.status,404);assert.deepEqual(await dispatch.json(),{error:'Not found'});assert.equal(dispatch.headers.get('Cache-Control'),'private, no-store');
  const write=await fetch(base+'/find/',{method:'POST'});assert.equal(write.status,405);assert.equal(write.headers.get('Allow'),'GET, HEAD');
 }finally{await stop();await rm(temporary,{recursive:true,force:true});}
});
