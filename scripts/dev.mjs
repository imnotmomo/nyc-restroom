import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { signupResponse } from '../worker/waitlist.mjs';
import { createStore } from './local-store.mjs';
import { legacyFinderAccessResponse } from '../worker/access.mjs';
import { moderationProxy } from './moderation-proxy.mjs';
const previewPort=Number(process.env.PORT??3000), nextPort=Number(process.env.NEXT_DEV_PORT??3001);
if (![previewPort,nextPort].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||previewPort===nextPort) throw new Error('Invalid local preview ports.');
const next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(nextPort)],{stdio:'inherit'});
const store=createStore();
const server=createServer(async(req,res)=>{
 try{
  if(!req.url?.startsWith('/')){res.writeHead(400);res.end('Invalid request URL.');return;}
  if(await moderationProxy(req,res))return;
  const legacyAccess=legacyFinderAccessResponse(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers}));
  if(legacyAccess){res.writeHead(legacyAccess.status,Object.fromEntries(legacyAccess.headers));res.end(await legacyAccess.text());return;}
  if(req.url.split('?')[0]==='/api/waitlist'){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const response=await signupResponse(request,store.save);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method not allowed');return;}
  const upstreamHeaders={Accept:req.headers.accept??'*/*'};
  for(const name of ['rsc','next-router-state-tree','next-router-prefetch','next-url'])if(req.headers[name])upstreamHeaders[name]=req.headers[name];
  await new Promise((resolveForward,rejectForward)=>{
   const upstream=httpRequest({hostname:'127.0.0.1',port:nextPort,path:req.url,method:req.method,headers:upstreamHeaders},response=>{
    res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
    response.on('end',resolveForward);response.on('error',rejectForward);
   });
   upstream.on('error',rejectForward);upstream.end();
  });
 }catch{res.writeHead(503);res.end('Starting Restroom Ready. Refresh in a moment.');}
});
// Next's development runtime needs its same-origin HMR WebSocket as well as HTTP.
server.on('upgrade',(req,socket,head)=>{
 if(!req.url?.startsWith('/_next/')){socket.destroy();return;}
 const upstream=httpRequest({hostname:'127.0.0.1',port:nextPort,path:req.url,method:'GET',headers:req.headers});
 upstream.on('upgrade',(response,peer,peerHead)=>{
  let headers=`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`;
  for(let i=0;i<response.rawHeaders.length;i+=2)headers+=`${response.rawHeaders[i]}: ${response.rawHeaders[i+1]}\r\n`;
  socket.write(headers+'\r\n');if(peerHead.length)socket.write(peerHead);if(head.length)peer.write(head);
  peer.pipe(socket);socket.pipe(peer);peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
 });
 upstream.on('error',()=>socket.destroy());upstream.on('response',()=>socket.destroy());upstream.end();
});
server.listen(previewPort,'127.0.0.1',()=>console.log(`Restroom Ready: http://localhost:${previewPort}`));
process.on('SIGINT',()=>{next.kill('SIGINT');store.close();server.close();process.exit(0);});
process.on('SIGTERM',()=>{next.kill('SIGTERM');store.close();server.close();process.exit(0);});
