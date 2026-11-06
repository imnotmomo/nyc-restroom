import { signupResponse, INSERT, values } from './waitlist.mjs';
import { legacyFinderAccessResponse } from './access.mjs';
import { createD1ConfirmationStore } from './confirmation-outbox.mjs';
import { confirmationDispatchReady, confirmationClientKey, confirmationDispatchResponse, CONFIRMATION_DISPATCH_PATH } from './confirmation-dispatch.mjs';
export const handler = {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(url.pathname===CONFIRMATION_DISPATCH_PATH)return confirmationDispatchResponse(request,()=>createD1ConfirmationStore(env.DB),env);
    const legacyAccess=legacyFinderAccessResponse(request);
    if(legacyAccess)return legacyAccess;
    if(url.pathname==='/api/waitlist')return signupResponse(request,async record=>{
      if(!env.DB)throw new Error('Database unavailable');
      const clientKey=await confirmationClientKey(request.headers.get('CF-Connecting-IP'),env);
      await createD1ConfirmationStore(env.DB).save(record,{enqueueConfirmation:confirmationDispatchReady(env),clientKey});
    });
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    let normalized;
    try { normalized=decodeURIComponent(url.pathname).replace(/\/$/,''); } catch { return new Response('Invalid URL',{status:400}); }
    const file=ASSETS[url.pathname] || ASSETS[normalized+'/index.html'] || ASSETS[normalized+'.html'];
    if(!file){const notFound=ASSETS['/404.html'];return new Response(request.method==='HEAD'?null:decodeAsset(notFound),{status:404,headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}});}
    return new Response(request.method==='HEAD'?null:decodeAsset(file),{headers:{'Content-Type':file.type,'Cache-Control':url.pathname.includes('/_next/static/')?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'geolocation=(self)'}});
  }
};
function decodeAsset(file){if(!file)return 'Not found';return Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));}
export default handler;
