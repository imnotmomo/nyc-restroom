import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

async function fixture() {
 const directory=await mkdtemp(join(tmpdir(),'rr-server-runtime-'));
 for(const path of ['scripts','worker','drizzle','dist/server']) await mkdir(join(directory,path),{recursive:true});
 for(const path of ['scripts/serve.mjs','scripts/local-store.mjs','worker/waitlist.mjs','drizzle/0000_waitlist.sql']) {
  await copyFile(new URL(`../${path}`,import.meta.url),join(directory,path));
 }
 await writeFile(join(directory,'dist/server/index.js'),"export default { async fetch() { return new Response('static fixture'); } };\n");
 return directory;
}

function launch(directory,origin) {
 const env={...process.env,PORT:'0',WAITLIST_DB_PATH:join(directory,'waitlist.sqlite')};
 if(origin===undefined) delete env.PUBLIC_ORIGIN;
 else env.PUBLIC_ORIGIN=origin;
 const child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
 let stderr='';
 child.stderr.on('data',(chunk)=>{stderr+=chunk.toString();});
 return {child,getStderr:()=>stderr};
}

async function startServer(directory,origin) {
 const {child,getStderr}=launch(directory,origin);
 const url=await new Promise((resolve,reject)=>{
  let output='';
  const timer=setTimeout(()=>{child.kill();reject(new Error('Server did not start.'));},5_000);
  child.once('error',(error)=>{clearTimeout(timer);reject(error);});
  child.once('exit',(code)=>{clearTimeout(timer);reject(new Error(`Server exited (${code}): ${getStderr()}`));});
  child.stdout.on('data',(chunk)=>{
   output+=chunk.toString();
   const port=output.match(/Restroom Ready: http:\/\/localhost:(\d+)/)?.[1];
   if(port){clearTimeout(timer);resolve(`http://127.0.0.1:${port}`);}
  });
 });
 return {url,async stop(){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}}};
}

const signup=(origin,email='runtime-test@example.test')=>({method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email,source:'home'})});

test('HTTPS canonical origin allows real signups behind an HTTP proxy and rejects foreign origins',async()=>{
 const directory=await fixture();
 const server=await startServer(directory,'https://nyc.example.test');
 try {
  const accepted=await fetch(`${server.url}/api/waitlist`,signup('https://nyc.example.test'));
  assert.equal(accepted.status,200);
  assert.deepEqual(await accepted.json(),{ok:true});
  const rejected=await fetch(`${server.url}/api/waitlist`,signup('https://foreign.example.test','foreign@example.test'));
  assert.equal(rejected.status,403);
  const spoofed=signup('https://foreign.example.test','spoofed@example.test');
  spoofed.headers['X-Forwarded-Proto']='https';
  spoofed.headers['X-Forwarded-Host']='nyc.example.test';
  assert.equal((await fetch(`${server.url}/api/waitlist`,spoofed)).status,403);
  const database=new DatabaseSync(join(directory,'waitlist.sqlite'));
  try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM waitlist').get().count,1); }
  finally { database.close(); }
 } finally {await server.stop();await rm(directory,{recursive:true,force:true});}
});

test('unset PUBLIC_ORIGIN preserves local HTTP same-origin signup behavior',async()=>{
 const directory=await fixture();
 const server=await startServer(directory);
 try {
  assert.equal((await fetch(`${server.url}/api/waitlist`,signup(server.url))).status,200);
  assert.equal((await fetch(`${server.url}/api/waitlist`,signup('https://foreign.example.test'))).status,403);
 } finally {await server.stop();await rm(directory,{recursive:true,force:true});}
});

test('health GET and HEAD are uncached, contain no user data, and reject other methods',async()=>{
 const directory=await fixture();
 const server=await startServer(directory,'https://nyc.example.test/');
 try {
  const response=await fetch(`${server.url}/api/health`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('content-type'),/^application\/json/);
  assert.deepEqual(await response.json(),{status:'ok'});
  const head=await fetch(`${server.url}/api/health`,{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal(head.headers.get('cache-control'),'no-store');
  assert.equal(head.headers.get('content-length'),response.headers.get('content-length'));
  assert.equal(await head.text(),'');
  const post=await fetch(`${server.url}/api/health`,{method:'POST'});
  assert.equal(post.status,405);
  assert.equal(post.headers.get('allow'),'GET, HEAD');
 } finally {await server.stop();await rm(directory,{recursive:true,force:true});}
});

test('invalid PUBLIC_ORIGIN fails startup before opening the signup database',async()=>{
 for(const origin of ['', 'not-an-origin','ftp://example.test','https://user:password@example.test','https://@example.test','https://example.test/path','https://example.test\\path','https://example.test?x=1','https://example.test#fragment',' https://example.test']) {
  const directory=await fixture();
  const {child,getStderr}=launch(directory,origin);
  const timer=setTimeout(()=>child.kill(),5_000);
  try {
   const [code]=await once(child,'exit');
   assert.equal(code,1,`Expected invalid PUBLIC_ORIGIN to fail: ${origin}`);
   assert.match(getStderr(),/PUBLIC_ORIGIN must be an http:\/\/ or https:\/\/ origin/);
   await assert.rejects(stat(join(directory,'waitlist.sqlite')),{code:'ENOENT'});
  } finally {clearTimeout(timer);await rm(directory,{recursive:true,force:true});}
 }
});
