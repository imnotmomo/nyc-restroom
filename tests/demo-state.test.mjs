import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = await readFile(new URL('../lib/demo-state.ts', import.meta.url), 'utf8');
const demo = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const id = 'demo-target-herald-square';
const now = '2026-10-16T18:00:00.000Z';

test('fresh demo has exactly one requested sample and reset creates independent state', () => {
  const first = demo.createDemoState(), reset = demo.createDemoState();
  assert.equal(first.venues.length, 1);
  assert.equal(first.venues[0].name, 'Target Herald Square');
  assert.equal(first.venues[0].code.code, '3434');
  assert.equal(first.venues[0].code.verifiedAt, null);
  assert.deepEqual(demo.demoRating(first.venues[0]), {average:4.5,count:2});
  first.venues[0].saved = true;
  assert.equal(reset.venues[0].saved, false);
});

test('one local vote replaces itself, removal restores seed, and clean filter follows actual local average', () => {
  let state = demo.createDemoState();
  state = demo.rateDemoVenue(state, id, 1);
  assert.equal(demo.demoRating(state.venues[0]).count, 3);
  assert.equal(demo.matchesDemoFilter(state.venues[0], 'clean'), false);
  state = demo.rateDemoVenue(state, id, 5);
  assert.deepEqual(demo.demoRating(state.venues[0]), {average:14/3,count:3});
  assert.equal(demo.matchesDemoFilter(state.venues[0], 'clean'), true);
  state = demo.rateDemoVenue(state, id, null);
  assert.deepEqual(demo.demoRating(state.venues[0]), {average:4.5,count:2});
  for (const value of [0, 6, 1.5, NaN]) assert.throws(() => demo.rateDemoVenue(state,id,value));
});

test('save and unsave immediately control Saved without changing public or accessibility demo attributes', () => {
  const initial = demo.createDemoState();
  const saved = demo.toggleDemoSaved(initial,id);
  assert.equal(initial.venues[0].saved,false);
  assert.equal(demo.matchesDemoFilter(saved.venues[0],'saved'),true);
  assert.equal(demo.matchesDemoFilter(saved.venues[0],'public'),true);
  assert.equal(demo.matchesDemoFilter(saved.venues[0],'accessible'),true);
  assert.equal(demo.matchesDemoFilter(demo.toggleDemoSaved(saved,id).venues[0],'saved'),false);
});

test('explicit verification changes only check time; editing code clears it and private saves auto-save place', () => {
  let state = demo.verifyDemoCode(demo.createDemoState(),id,now);
  assert.equal(state.venues[0].code.verifiedAt,now);
  assert.equal(state.venues[0].code.updatedAt,demo.DEMO_SEED_TIME);
  state=demo.saveDemoCode(state,id,'3434','private',now);
  assert.equal(state.venues[0].saved,true);
  assert.equal(state.venues[0].code.verifiedAt,now);
  state=demo.saveDemoCode(state,id,'0012#','public','2026-10-16T18:01:00.000Z');
  assert.equal(state.venues[0].code.code,'0012#');
  assert.equal(state.venues[0].code.verifiedAt,null);
  assert.equal(state.venues[0].code.updatedAt,'2026-10-16T18:01:00.000Z');
  state=demo.deleteDemoCode(state,id);
  assert.equal(state.venues[0].code,null);
  assert.equal(state.venues[0].saved,true);
});

test('adding local samples is explicit, bounded, immutable and has no invented initial rating', () => {
  const initial=demo.createDemoState();
  const input={name:'My local sample',address:'112 W 34th St, New York',latitude:40.749814,longitude:-73.989081,isPublic:false,isAccessible:false,code:'0012',visibility:'private'};
  const state=demo.addDemoVenue(initial,input,now);
  assert.equal(initial.venues.length,1);
  assert.equal(state.venues.length,2);
  assert.equal(state.venues[1].saved,true);
  assert.deepEqual(demo.demoRating(state.venues[1]),{average:null,count:0});
  assert.equal(demo.matchesDemoFilter(state.venues[1],'clean'),false);
  assert.equal(demo.matchesDemoFilter(state.venues[1],'public'),false);
  assert.equal(demo.matchesDemoFilter(state.venues[1],'accessible'),false);
  assert.throws(()=>demo.addDemoVenue(initial,{...input,latitude:0},now));
  assert.throws(()=>demo.addDemoVenue(initial,{...input,name:''},now));
  assert.throws(()=>demo.addDemoVenue(initial,{...input,code:'private\ncode'},now));
});
