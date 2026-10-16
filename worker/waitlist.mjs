export const SOURCES = new Set(["home", "conditions", "entry-route", "dated-reports"]);
export const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
export function validateSignup(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Please enter a valid email address.");
  if (body.website) throw new Error("Please try again.");
  if (typeof body.email !== "string") throw new Error("Please enter a valid email address.");
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@\x00-\x1f]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) throw new Error("Please enter a valid email address.");
  if (!SOURCES.has(body.source)) throw new Error("Please join from one of our signup pages.");
  const record={email,source:body.source,created_at:new Date().toISOString()};
  for(const field of UTM_FIELDS){
    if(body[field]!=null && typeof body[field]!=="string")throw new Error("The campaign link is invalid.");
    const v=(body[field]??"").trim().toLowerCase();
    if(v.length>120 || /[\x00-\x1f\x7f]/.test(v))throw new Error("The campaign link is invalid.");
    record[field]=v;
  }
  return record;
}
export const INSERT = `INSERT INTO waitlist (email, source, created_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`;
export const values = r => [r.email,r.source,r.created_at,...UTM_FIELDS.map(k=>r[k])];
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
export async function signupResponse(request,store){
  if(request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
  const origin=request.headers.get("Origin");
  if(origin && origin!==new URL(request.url).origin)return json({error:"Please submit the form from this site."},403);
  if(!request.headers.get("Content-Type")?.includes("application/json"))return json({error:"Please submit the signup form."},415);
  let record;
  try { const text=await request.text(); if(new TextEncoder().encode(text).byteLength>4096)return json({error:"This submission is too large."},413);record=validateSignup(JSON.parse(text)); }
  catch(e){return json({error:e instanceof SyntaxError?"Please submit a valid signup.":e.message},400);}
  try {await store(record);return json({ok:true});}
  catch(error){
    if(error?.code==='WAITLIST_CONFIRMATION_RATE_LIMIT')return json({error:"Too many signup requests. Please try again later."},429);
    return json({error:"Your email wasn’t saved. Please try again shortly."},503);
  }
}
