import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { signupResponse } from '../worker/waitlist.mjs';
import { createStore } from './local-store.mjs';
const port=Number(process.env.PORT??3000);
const store=createStore();
const source=await readFile(new URL('../dist/server/index.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const c of req){chunks.push(c);if(chunks.reduce((n,b)=>n+b.length,0)>4096){res.writeHead(413);res.end();return;}}
  const url=`http://${req.headers.host}${req.url}`;
  const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const response=new URL(url).pathname==='/api/waitlist'?await signupResponse(request,store.save):await worker.fetch(request,{});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Something went wrong. Please try again.');}
}).listen(port,'127.0.0.1',()=>console.log(`Restroom Ready: http://localhost:${port}`));
