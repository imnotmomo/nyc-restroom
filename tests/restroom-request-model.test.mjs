import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
const uri=source=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const passcodeURL=uri(await readFile(new URL('../lib/passcode-model.ts',import.meta.url),'utf8'));
const model=await import(uri((await readFile(new URL('../lib/restroom-request-model.ts',import.meta.url),'utf8')).replaceAll('"@/lib/passcode-model"',JSON.stringify(passcodeURL))));
const pending=()=>({schemaVersion:1,status:'pending',revision:1,submittedAt:{seconds:1},listing:{name:'Fixture'},codeDraft:null});
const terminal=(status='approved')=>({...pending(),status,revision:2,reviewedAt:{seconds:2},reason:status==='approved'?'':'duplicate',codeFingerprint:null});

test('private request metadata accepts only the exact six pending or nine terminal fields',()=>{
 assert.equal(model.normalizeRestroomRequestEnvelope(pending()).status,'pending');
 for(const status of ['approved','denied'])assert.equal(model.normalizeRestroomRequestEnvelope(terminal(status)).status,status);
 for(const data of [{...pending(),ownerUID:'alice'},{...pending(),reviewedAt:1},{...pending(),status:'public'},{...pending(),revision:2},{...terminal(),revision:1},{...terminal(),reviewedAt:undefined,extra:1},{...pending(),listing:[]}])assert.throws(()=>model.normalizeRestroomRequestEnvelope(data));
 const missing=pending();delete missing.codeDraft;assert.throws(()=>model.normalizeRestroomRequestEnvelope(missing));
});
test('reviewed requests scrub code drafts and enforce bounded reason and digest contracts',()=>{
 for(const data of [{...terminal(),codeDraft:{code:'1234',visibility:'private'}},{...terminal(),reason:'duplicate'},{...terminal('denied'),reason:''},{...terminal('denied'),reason:'free text'},{...terminal(),codeFingerprint:'x'.repeat(64)},{...terminal(),codeFingerprint:'A'.repeat(64)}])assert.throws(()=>model.normalizeRestroomRequestEnvelope(data));
 for(const reason of model.RESTROOM_REQUEST_DENIAL_REASONS)assert.equal(model.normalizeRestroomRequestEnvelope({...terminal('denied'),reason}).reason,reason);
 assert.equal(model.normalizeRestroomRequestEnvelope({...terminal(),codeFingerprint:'a'.repeat(64)}).codeFingerprint,'a'.repeat(64));
});
test('pending code metadata is canonical and never coerces privacy or extra fields',()=>{
 const code={code:'0123#',visibility:'private'};assert.deepEqual(model.normalizeRestroomRequestEnvelope({...pending(),codeDraft:code}).codeDraft,code);
 for(const codeDraft of [{...code,ownerUID:'alice'},{...code,code:' 0123# '},{...code,visibility:'everyone'},{...code,code:''},{...code,code:'\n1234'}])assert.throws(()=>model.normalizeRestroomRequestEnvelope({...pending(),codeDraft}));
});
test('retry fingerprint matches independent SHA256 UTF8 NUL-separated contract and distinguishes privacy',async()=>{
 assert.equal(await model.restroomRequestCodeFingerprint(null),null);
 const expected=createHash('sha256').update('rr-request-code-v1\u0000private\u00000123#','utf8').digest('hex');
 const fingerprint=await model.restroomRequestCodeFingerprint({code:' 0123# ',visibility:'private'});
 assert.equal(fingerprint,expected);assert.match(fingerprint,/^[0-9a-f]{64}$/);
 assert.notEqual(fingerprint,await model.restroomRequestCodeFingerprint({code:'0123#',visibility:'public'}));
});
test('confirmation copy describes review status without claiming immediate publication',()=>{
 assert.match(model.restroomRequestStatusMessage({status:'pending'}),/^Submitted for review/);
 assert.match(model.restroomRequestStatusMessage({status:'approved'}),/when the map refreshes/);
 assert.match(model.restroomRequestStatusMessage({status:'denied',reason:'duplicate'}),/not approved.*duplicate/);
});
