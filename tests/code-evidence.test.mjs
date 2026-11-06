import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
const model=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(await readFile(new URL('../lib/code-evidence-model.ts',import.meta.url),'utf8'))).toString('base64'));
const row=(id,stamp,verified=null,used=null)=>({id:'v2:'+id,kind:'v2',reportID:id,placeID:'city-one',code:'synthetic',codeVersion:stamp,codeUpdatedAt:new Date('2026-01-01'),verifiedAt:verified?new Date('2026-01-01'):null,verifiedVersion:verified,visibility:'public',ownership:'other',usedCount:used,invalidCount:null,currentVote:null,feedbackLoaded:used!==null,createdAt:null,createdVersion:null});
test('verification takes priority over report recency, retaining exact nanoseconds',()=>{
 const older=row('older','1790000000:1000','1790000000:3001'),newer=row('newer','1790000000:2000','1790000000:3000');
 assert.equal(model.preferredPublicCode([newer,older]).id,older.id);
 assert.equal(older.verifiedAt.getTime(),newer.verifiedAt.getTime());
 assert.equal(model.preferredPublicCode([row('unverified','1790000000:9999'),older]).id,older.id);
});
test('unverified reports use exact report version then deterministic source identity',()=>{
 const a=row('a','1790000000:1001'),b=row('b','1790000000:1000');assert.equal(model.preferredPublicCode([b,a]).id,a.id);
 assert.deepEqual(model.sortedCodeEvidence([row('a','1790000000:1'),row('b','1790000000:1')]).map(r=>r.reportID),['b','a']);
});
test('latest report needs four current distinct Used before history presentation retires',()=>{
 const old=row('old','1790000000:1','1790000000:5'),latest=row('latest','1790000000:2',null,3),middle=row('middle','1790000000:0');
 assert.equal(model.visiblePublicCodeEvidence([latest,old,middle]).length,3);
 assert.deepEqual(model.visiblePublicCodeEvidence([{...latest,usedCount:4},old,middle]).map(r=>r.reportID),['old','latest']);
 assert.equal(model.visiblePublicCodeEvidence([{...latest,usedCount:4},old,middle],false).length,3);
});
test('an older four-count record cannot retire a new alternative; Invalid never gates history',()=>{
 const old=row('old','1790000000:1',null,4),latest={...row('latest','1790000000:2',null,0),invalidCount:100};
 assert.equal(model.visiblePublicCodeEvidence([old,latest]).length,2);
});
test('private and owned records never enter the public preference or public history',()=>{
 const privateRow={...row('secret','1790000000:9','1790000000:10'),visibility:'private',ownership:'own'};
 const publicRow=row('public','1790000000:1');
 assert.equal(model.preferredPublicCode([privateRow,publicRow]).id,publicRow.id);assert.deepEqual(model.ownedCodeEvidence([privateRow,publicRow]),[privateRow]);
});
test('version parser rejects aliases, precision loss, noncanonical and invalid ranges',()=>{
 for(const bad of ['01790000000:1','1790000000:01','1790000000:1000000000','1790000000:-1','NaN:1','1:0','1790000000.1:0','1790000000:1\n'])assert.throws(()=>model.codeVersionParts(bad));
 assert.deepEqual(model.codeVersionParts('1790000000:123457000'),[1790000000,123457000]);
});

test('an orphan verification version or invalid display date cannot claim verified preference',()=>{
 const old=row('old','1790000000:1','1790000000:20'),latest=row('latest','1790000000:2');
 for(const verifiedAt of [null,new Date('invalid')])assert.equal(model.preferredPublicCode([{...old,verifiedAt},latest]).id,latest.id);
});
