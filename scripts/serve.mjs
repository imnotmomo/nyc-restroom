import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { signupResponse } from '../worker/waitlist.mjs';
import { createStore } from './local-store.mjs';
const port=Number(process.env.PORT??3000);
let publicOrigin;
if (process.env.PUBLIC_ORIGIN !== undefined) {
 const invalidOrigin=()=>new Error('PUBLIC_ORIGIN must be an http:// or https:// origin with no credentials, path, query, or fragment.');
 const value=process.env.PUBLIC_ORIGIN;
 let parsed;
 try { parsed=new URL(value); } catch { throw invalidOrigin(); }
 if (!/^https?:\/\/[^/?#]+\/?$/.test(value) || /[\s\\@]/.test(value)
   || parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash) throw invalidOrigin();
 publicOrigin=parsed.origin;
}
const store=createStore();
const source=await readFile(new URL('../dist/server/index.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const server=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const c of req){chunks.push(c);if(chunks.reduce((n,b)=>n+b.length,0)>4096){res.writeHead(413);res.end();return;}}
  if(!req.url?.startsWith('/')){res.writeHead(400);res.end('Invalid request URL.');return;}
  const url=`${publicOrigin??`http://${req.headers.host}`}${req.url}`;
  const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const pathname=new URL(url).pathname;
  let response;
  if(pathname==='/api/health'){
   if(!['GET','HEAD'].includes(request.method)) response=new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
   else {
    const body=JSON.stringify({status:'ok'});
    response=new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Length':String(Buffer.byteLength(body)),'Cache-Control':'no-store'}});
   }
  } else response=pathname==='/api/waitlist'?await signupResponse(request,store.save):await worker.fetch(request,{});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Something went wrong. Please try again.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Restroom Ready: http://localhost:${server.address().port}`));
