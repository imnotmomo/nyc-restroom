import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { signupResponse } from '../worker/waitlist.mjs';
import { createStore } from './local-store.mjs';
const next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3001'],{stdio:'inherit'});
const store=createStore();
const server=createServer(async(req,res)=>{
 try{
  if(req.url.split('?')[0]==='/api/waitlist'){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const response=await signupResponse(request,store.save);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  const response=await fetch('http://127.0.0.1:3001'+req.url,{redirect:'manual',headers:{Accept:req.headers.accept??'*/*'}});
  const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];delete headers['content-length'];res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503);res.end('Starting Restroom Ready. Refresh in a moment.');}
});
server.listen(3000,'127.0.0.1',()=>console.log('Restroom Ready: http://localhost:3000'));
process.on('SIGINT',()=>{next.kill('SIGINT');store.close();server.close();process.exit(0);});
process.on('SIGTERM',()=>{next.kill('SIGTERM');store.close();server.close();process.exit(0);});
