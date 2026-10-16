import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createFinderAccessGate, FINDER_ACCESS_COOKIE, FINDER_ACCESS_SECONDS, isFinderResource, privateFinderResponse } from '../worker/access.mjs';

const fixtureEnv={FINDER_ACCESS_PASSCODE:'example-test-passcode',FINDER_ACCESS_SECRET:'synthetic-secret-for-access-tests-only-0123456789'};
const post=(passcode=fixtureEnv.FINDER_ACCESS_PASSCODE,options={})=>new Request('https://example.test/api/finder-access',{
 method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.test',...options.headers},body:JSON.stringify({passcode}),...options,
});
const cookiePair=response=>response.headers.get('Set-Cookie').split(';')[0];
const protectedRequest=(cookie,path='/find/',headers={})=>new Request(`https://example.test${path}`,{headers:{...(cookie?{Cookie:cookie}:{}),...headers}});
const privateHeaders=response=>{assert.match(response.headers.get('Cache-Control'),/private.*no-store/);assert.match(response.headers.get('Vary'),/Cookie/);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');};

test('finder aliases, encoded paths and route payloads are all classified before static routing',()=>{
 for(const path of ['/find','/find/','/find.html','/find.txt','/find/index.html','/find/index.txt','/find/__next.abc.txt','/%66ind/','/%2566ind/','/find%2findex.txt','//find//index.html','/x/%252e%252e/%2566ind/','/FIND/'])assert.equal(isFinderResource(path),true,path);
 for(const path of ['/','/demo/','/conditions/','/access/','/_next/static/file.js','/finder/'])assert.equal(isFinderResource(path),false,path);
});

test('missing or invalid runtime configuration fails closed while no token is issued',async()=>{
 const gate=createFinderAccessGate();
 for(const env of [{},{FINDER_ACCESS_PASSCODE:'x'},{...fixtureEnv,FINDER_ACCESS_SECRET:'short'}]){
  const denied=await gate.protect(protectedRequest(),env);assert.equal(denied.status,503);privateHeaders(denied);
  const login=await gate.handle(post(),env);assert.equal(login.status,503);assert.equal(login.headers.get('Set-Cookie'),null);
 }
});

test('same-origin POST issues only a signed secure HttpOnly eight-hour cookie, never the passcode',async()=>{
 const gate=createFinderAccessGate();const response=await gate.handle(post(),fixtureEnv);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});privateHeaders(response);
 const header=response.headers.get('Set-Cookie');assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/SameSite=Lax/);assert.match(header,/Path=\//);assert.match(header,new RegExp(`Max-Age=${FINDER_ACCESS_SECONDS}`));
 assert.equal(header.includes(fixtureEnv.FINDER_ACCESS_PASSCODE),false);assert.equal(header.includes(fixtureEnv.FINDER_ACCESS_SECRET),false);
 assert.equal(await gate.protect(protectedRequest(cookiePair(response)),fixtureEnv),null);
});

test('wrong codes, foreign or missing Origins, unsupported bodies and methods never authenticate',async()=>{
 const gate=createFinderAccessGate();const wrong=await gate.handle(post('different-test-code'),fixtureEnv);assert.equal(wrong.status,401);assert.equal(wrong.headers.get('Set-Cookie'),null);
 for(const origin of [null,'https://foreign.test','null']){
  const request=post();if(origin===null)request.headers.delete('Origin');else request.headers.set('Origin',origin);
  assert.equal((await gate.handle(request,fixtureEnv)).status,403);
 }
 const cross=post();cross.headers.set('Sec-Fetch-Site','cross-site');assert.equal((await gate.handle(cross,fixtureEnv)).status,403);
 assert.equal((await gate.handle(new Request('https://example.test/api/finder-access'),fixtureEnv)).status,405);
 const form=new Request('https://example.test/api/finder-access',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/x-www-form-urlencoded'},body:'passcode=example-test-passcode'});
 assert.equal((await gate.handle(form,fixtureEnv)).status,415);
 const huge=new Request('https://example.test/api/finder-access',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:'x'.repeat(1025)});
 assert.equal((await gate.handle(huge,fixtureEnv)).status,413);
 const unknown=new Request('https://example.test/api/finder-access',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({passcode:fixtureEnv.FINDER_ACCESS_PASSCODE,next:'https://foreign.test'})});
 assert.equal((await gate.handle(unknown,fixtureEnv)).status,400);
});

test('tampered, duplicate, expired, cross-host and rotated-config cookies cannot unlock the finder',async()=>{
 let now=Date.parse('2026-10-16T12:00:00Z');const gate=createFinderAccessGate({now:()=>now});const login=await gate.handle(post(),fixtureEnv);const cookie=cookiePair(login);
 const value=cookie.slice(FINDER_ACCESS_COOKIE.length+1);const[timestamp,signature]=value.split('.');
 for(const altered of [`${FINDER_ACCESS_COOKIE}=${timestamp}.${signature.slice(0,-1)}!`,`${cookie}; ${cookie}`,`${FINDER_ACCESS_COOKIE}=unsigned`,`${FINDER_ACCESS_COOKIE}=${timestamp}.AAAA`])assert.equal((await gate.protect(protectedRequest(altered),fixtureEnv)).status,303);
 assert.equal(await gate.authorized(new Request('https://other.test/find/',{headers:{Cookie:cookie}}),fixtureEnv),false);
 assert.equal(await gate.authorized(protectedRequest(cookie),{...fixtureEnv,FINDER_ACCESS_PASSCODE:'rotated-test-passcode'}),false);
 assert.equal(await gate.authorized(protectedRequest(cookie),{...fixtureEnv,FINDER_ACCESS_SECRET:'another-synthetic-secret-01234567890123456789'}),false);
 now+=FINDER_ACCESS_SECONDS*1000;assert.equal((await gate.protect(protectedRequest(cookie),fixtureEnv)).status,303);
});

test('chunked bodies without Content-Length are stopped and cancelled at the byte limit',async()=>{
 let cancelled=false,pulls=0;
 const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(600).fill(120));},cancel(){cancelled=true;}});
 const request=new Request('https://example.test/api/finder-access',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body,duplex:'half'});
 assert.equal(request.headers.has('Content-Length'),false);
 const response=await createFinderAccessGate().handle(request,fixtureEnv);
 assert.equal(response.status,413);assert.equal(cancelled,true);assert.ok(pulls<=3);assert.equal(response.headers.get('Set-Cookie'),null);privateHeaders(response);
});

test('normal navigation redirects only to access, while unauthorized RSC payloads return no live content',async()=>{
 const gate=createFinderAccessGate();const html=await gate.protect(protectedRequest(null,'/find/?next=https://foreign.test'),fixtureEnv);
 assert.equal(html.status,303);assert.equal(html.headers.get('Location'),'/access/');privateHeaders(html);
 for(const[path,headers]of [['/find.txt',{}],['/find/index.txt',{}],['/%66ind%2e%74%78%74',{}],['/find/',{RSC:'1'}],['/find/',{Accept:'text/x-component'}]]){
  const response=await gate.protect(protectedRequest(null,path,headers),fixtureEnv);assert.equal(response.status,401);privateHeaders(response);assert.equal((await response.json()).error,'Finder access is required.');
 }
});

test('logout requires same origin and clears only the host-scoped access cookie',async()=>{
 const gate=createFinderAccessGate();const logout=new Request('https://example.test/api/finder-access',{method:'DELETE',headers:{Origin:'https://example.test'}});
 const response=await gate.handle(logout,fixtureEnv);assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);assert.match(response.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);privateHeaders(response);
 logout.headers.set('Origin','https://foreign.test');assert.equal((await gate.handle(logout,fixtureEnv)).status,403);
});

test('bounded per-client attempt windows resist concurrent brute force and expire',async()=>{
 let now=Date.parse('2026-10-16T12:00:00Z');const gate=createFinderAccessGate({now:()=>now});
 const responses=await Promise.all(Array.from({length:12},()=>gate.handle(post('wrong-code'),fixtureEnv)));
 assert.equal(responses.filter(response=>response.status===401).length,10);assert.equal(responses.filter(response=>response.status===429).length,2);
 const blocked=await gate.handle(post(),fixtureEnv);assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'300');privateHeaders(blocked);
 now+=300001;assert.equal((await gate.handle(post(),fixtureEnv)).status,200);
});

test('protected responses retain RSC vary keys, discard validators and cannot use public caches',()=>{
 const response=privateFinderResponse(new Response('protected',{headers:{'Cache-Control':'public,max-age=999','Vary':'RSC, Next-Router-State-Tree','ETag':'secret','Last-Modified':'yesterday'}}));
 privateHeaders(response);assert.match(response.headers.get('Vary'),/RSC/);assert.equal(response.headers.get('ETag'),null);assert.equal(response.headers.get('Last-Modified'),null);
});

test('the actual standalone packager and Node server enforce the gate without breaking marketing, signup or health',async()=>{
 const root=new URL('../',import.meta.url);const temporary=await mkdtemp(join(tmpdir(),'rr-access-server-'));let child;
 async function copy(relative){const destination=join(temporary,relative);await mkdir(dirname(destination),{recursive:true});await copyFile(new URL(relative,root),destination);}
 async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}child=null;}
 async function start(env={}){
  child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:temporary,env:{...process.env,FINDER_ACCESS_PASSCODE:'',FINDER_ACCESS_SECRET:'',...env,PORT:'0',PUBLIC_ORIGIN:'https://example.test',WAITLIST_DB_PATH:join(temporary,'waitlist.sqlite')},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(new Error('Local access fixture did not start.')),5000);child.stderr.on('data',chunk=>errors+=chunk);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local access fixture exited (${code}): ${errors}`));});});
 }
 try{
  for(const file of ['worker/index.mjs','worker/access.mjs','worker/waitlist.mjs','worker/confirmation-email.mjs','worker/confirmation-outbox.mjs','worker/confirmation-dispatch.mjs','scripts/serve.mjs','scripts/local-store.mjs','drizzle/0000_waitlist.sql','drizzle/0001_waitlist_confirmations.sql'])await copy(file);
  const files={'out/index.html':'public marketing','out/demo/index.html':'public demo','out/access/index.html':'access form','out/find/index.html':'private live finder','out/find/index.txt':'private nested RSC','out/find.txt':'private root RSC','.openai/hosting.json':'{}'};
  for(const[path,body]of Object.entries(files)){await mkdir(dirname(join(temporary,path)),{recursive:true});await writeFile(join(temporary,path),body);}
  const build=spawn(process.execPath,[new URL('../scripts/build-worker.mjs',import.meta.url).pathname],{cwd:temporary,stdio:'pipe'});const[buildStatus]=await once(build,'exit');assert.equal(buildStatus,0);
  const bundle=await readFile(join(temporary,'dist/server/index.js'),'utf8');assert.equal(bundle.includes(fixtureEnv.FINDER_ACCESS_PASSCODE),false);assert.equal(bundle.includes(fixtureEnv.FINDER_ACCESS_SECRET),false);
  let base=await start();assert.equal((await fetch(base+'/find/',{redirect:'manual'})).status,503);assert.equal(await(await fetch(base+'/')).text(),'public marketing');await stop();
  base=await start(fixtureEnv);assert.equal((await fetch(base+'/api/health')).status,200);assert.equal(await(await fetch(base+'/demo/')).text(),'public demo');
  for(const path of ['/find/','/%66ind/','/find/index.html']){const response=await fetch(base+path,{redirect:'manual'});assert.equal(response.status,303);privateHeaders(response);assert.equal(await response.text(),'');}
  for(const path of ['/find.txt','/find/index.txt','/find/__next.abc.txt']){const response=await fetch(base+path,{redirect:'manual'});assert.equal(response.status,401);assert.equal((await response.text()).includes('private'),false);}
  const login=await fetch(base+'/api/finder-access',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({passcode:fixtureEnv.FINDER_ACCESS_PASSCODE})});assert.equal(login.status,200);const cookie=cookiePair(login);
  const finder=await fetch(base+'/find/',{headers:{Cookie:cookie,'If-None-Match':'anything'}});assert.equal(finder.status,200);assert.equal(await finder.text(),'private live finder');privateHeaders(finder);
  const payload=await fetch(base+'/find/index.txt',{headers:{Cookie:cookie,RSC:'1'}});assert.equal(payload.status,200);assert.equal(await payload.text(),'private nested RSC');privateHeaders(payload);
  const signup=await fetch(base+'/api/waitlist',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:'access-test@example.test',source:'home'})});assert.equal(signup.status,200);
  const logout=await fetch(base+'/api/finder-access',{method:'DELETE',headers:{Origin:'https://example.test'}});assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
 }finally{await stop();await rm(temporary,{recursive:true,force:true});}
});
