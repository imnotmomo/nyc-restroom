import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
const source=await readFile(new URL('../lib/rating-model.ts',import.meta.url),'utf8');
const model=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('rating model accepts whole 1–5 stars and rejects floats/coercion/nonfinite values',()=>{
 for(const n of [1,2,3,4,5])assert.equal(model.isValidStars(n),true);
 for(const n of [0,6,2.5,NaN,Infinity,'4',true,null,{},[]])assert.equal(model.isValidStars(n),false);
});
test('aggregate transitions add, replace and remove without double-counting',()=>{
 let totals=model.applyRatingChange({ratingCount:0,ratingSum:0},null,4);
 assert.deepEqual(totals,{ratingCount:1,ratingSum:4});
 totals=model.applyRatingChange(totals,null,2);
 assert.deepEqual(totals,{ratingCount:2,ratingSum:6});
 totals=model.applyRatingChange(totals,4,5);
 assert.deepEqual(totals,{ratingCount:2,ratingSum:7});
 assert.deepEqual(model.applyRatingChange(totals,5,5),totals);
 totals=model.applyRatingChange(totals,2,null);
 assert.deepEqual(totals,{ratingCount:1,ratingSum:5});
 assert.deepEqual(model.applyRatingChange(totals,5,null),{ratingCount:0,ratingSum:0});
});
test('every single-vote replacement preserves count and applies exact sum delta',()=>{
 for(const previous of [1,2,3,4,5])for(const next of [1,2,3,4,5]){
  assert.deepEqual(model.applyRatingChange({ratingCount:2,ratingSum:6},previous,next),{ratingCount:2,ratingSum:6-previous+next});
 }
});
test('impossible, negative, fractional and overflow totals are not repaired silently',()=>{
 for(const totals of [{ratingCount:-1,ratingSum:0},{ratingCount:0,ratingSum:1},{ratingCount:1,ratingSum:6},{ratingCount:1.5,ratingSum:5},{ratingCount:1,ratingSum:2.5},{ratingCount:1_000_001,ratingSum:1_000_001}]){
  assert.equal(model.isValidRatingTotals(totals),false);
  assert.throws(()=>model.applyRatingChange(totals,null,4));
 }
 assert.throws(()=>model.applyRatingChange({ratingCount:1,ratingSum:1},5,null));
 assert.throws(()=>model.applyRatingChange({ratingCount:1_000_000,ratingSum:1_000_000},null,4));
});
