import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = await readFile(new URL('../lib/demo-state.ts', import.meta.url), 'utf8');
const demo = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const id = 'demo-target-herald-square';
const ownID = 'demo-own-target-report';
const otherID = 'demo-visitor-target-report';
const now = '2026-10-16T18:00:00.000Z';

test('fresh demo has one venue, distinct public and private owners, and an independent reset', () => {
  const first = demo.createDemoState(), reset = demo.createDemoState();
  assert.equal(first.venues.length, 1);
  const venue = first.venues[0];
  assert.equal(venue.name, 'Target Herald Square');
  assert.equal(venue.ownCode.code, '3535');
  assert.equal(venue.ownCode.visibility, 'private');
  assert.equal(venue.publicReports[0].code, '3434');
  assert.notEqual(venue.ownCode.reportID, venue.publicReports[0].reportID);
  assert.equal(venue.ownCode.verifiedAt, null);
  assert.equal(venue.publicReports[0].verifiedAt, null);
  assert.equal(venue.saved, true);
  assert.deepEqual(demo.demoRating(venue), {average:4.5,count:2});
  venue.saved = false;
  venue.ownCode.code = 'changed';
  venue.publicReports[0].code = 'changed';
  assert.equal(reset.venues[0].saved, true);
  assert.equal(reset.venues[0].ownCode.code, '3535');
  assert.equal(reset.venues[0].publicReports[0].code, '3434');
});

test('public preview excludes private values and all editing/verification controls', () => {
  const venue = demo.createDemoState().venues[0];
  const owner = demo.visibleDemoCodes(venue,'owner');
  assert.deepEqual(owner.map(code=>code.code),['3535','3434']);
  assert.deepEqual(owner.map(code=>code.canEdit),[true,false]);
  assert.deepEqual(owner.map(code=>code.canVerify),[true,true]);
  const publicView = demo.visibleDemoCodes(venue,'public');
  assert.deepEqual(publicView.map(code=>code.code),['3434']);
  assert.equal(JSON.stringify(publicView).includes('3535'),false);
  assert.equal(publicView.every(code=>!code.canEdit&&!code.canVerify),true);
});

test('one local vote replaces itself, removal restores seed, and clean filter follows local average', () => {
  let state = demo.createDemoState();
  state = demo.rateDemoVenue(state, id, 1);
  assert.equal(demo.demoRating(state.venues[0]).count, 3);
  assert.equal(demo.matchesDemoFilter(state.venues[0], 'clean'), false);
  state = demo.rateDemoVenue(state, id, 5);
  assert.deepEqual(demo.demoRating(state.venues[0]), {average:14/3,count:3});
  assert.equal(demo.matchesDemoFilter(state.venues[0], 'clean'), true);
  state = demo.rateDemoVenue(state, id, null);
  assert.deepEqual(demo.demoRating(state.venues[0]), {average:4.5,count:2});
  for (const value of [0, 0.5, 5.5, 6, 1.25, NaN, Infinity, '4', true]) assert.throws(() => demo.rateDemoVenue(state,id,value));
});

test('demo half-star votes replace themselves exactly and keep the clean threshold at four', () => {
  let state=demo.createDemoState();
  for(const rating of [1,1.5,2,2.5,3,3.5,4,4.5,5]){
    state=demo.rateDemoVenue(state,id,rating);
    assert.equal(state.venues[0].ownRating,rating);
    assert.deepEqual(demo.demoRating(state.venues[0]),{average:(9+rating)/3,count:3});
    assert.equal(demo.matchesDemoFilter(state.venues[0],'clean'),(9+rating)/3>=4);
  }
  state=demo.rateDemoVenue(state,id,null);
  assert.deepEqual(demo.demoRating(state.venues[0]),{average:4.5,count:2});
});

test('unsave and save control Saved without changing public or accessibility demo attributes', () => {
  const initial = demo.createDemoState();
  const unsaved = demo.toggleDemoSaved(initial,id);
  assert.equal(initial.venues[0].saved,true);
  assert.equal(demo.matchesDemoFilter(unsaved.venues[0],'saved'),false);
  assert.equal(demo.matchesDemoFilter(unsaved.venues[0],'public'),true);
  assert.equal(demo.matchesDemoFilter(unsaved.venues[0],'accessible'),true);
  assert.equal(demo.matchesDemoFilter(demo.toggleDemoSaved(unsaved,id).venues[0],'saved'),true);
});

test('verification targets a stable report ID and never updates a different report', () => {
  let state = demo.verifyDemoCode(demo.createDemoState(),id,otherID,now);
  assert.equal(state.venues[0].publicReports[0].verifiedAt,now);
  assert.equal(state.venues[0].ownCode.verifiedAt,null);
  assert.equal(state.venues[0].publicReports[0].updatedAt,demo.DEMO_SEED_TIME);
  const later='2026-10-16T18:01:00.000Z';
  state=demo.verifyDemoCode(state,id,ownID,later);
  assert.equal(state.venues[0].ownCode.verifiedAt,later);
  assert.equal(state.venues[0].publicReports[0].verifiedAt,now);
  assert.throws(()=>demo.verifyDemoCode(state,id,'3434',now));
  assert.throws(()=>demo.verifyDemoCode(state,id,'missing-report',now));
});

test('sharing never transfers ownership or makes another submitter editable', () => {
  let state=demo.verifyDemoCode(demo.createDemoState(),id,ownID,now);
  const otherBefore={...state.venues[0].publicReports[0]};
  state=demo.saveDemoCode(state,id,'3535','public','2026-10-16T18:02:00.000Z');
  assert.equal(state.venues[0].ownCode.reportID,ownID);
  assert.equal(state.venues[0].ownCode.verifiedAt,now);
  assert.equal(state.venues[0].ownCode.updatedAt,demo.DEMO_SEED_TIME);
  const owner=demo.visibleDemoCodes(state.venues[0],'owner');
  assert.equal(owner.find(report=>report.reportID===ownID).canEdit,true);
  assert.equal(owner.find(report=>report.reportID===otherID).canEdit,false);
  assert.deepEqual(demo.visibleDemoCodes(state.venues[0],'public').map(report=>report.code),['3434','3535']);
  state=demo.saveDemoCode(state,id,'3535','private','2026-10-16T18:03:00.000Z');
  assert.equal(state.venues[0].ownCode.verifiedAt,now);
  assert.deepEqual(demo.visibleDemoCodes(state.venues[0],'public').map(report=>report.code),['3434']);
  assert.deepEqual(state.venues[0].publicReports[0],otherBefore);
});

test('code changes reset only own verification and preserve other shared code and dates', () => {
  let state=demo.verifyDemoCode(demo.createDemoState(),id,otherID,now);
  state=demo.verifyDemoCode(state,id,ownID,now);
  const otherBefore={...state.venues[0].publicReports[0]};
  state=demo.saveDemoCode(state,id,'0012#','private','2026-10-16T18:04:00.000Z');
  assert.equal(state.venues[0].ownCode.code,'0012#');
  assert.equal(state.venues[0].ownCode.reportID,ownID);
  assert.equal(state.venues[0].ownCode.verifiedAt,null);
  assert.equal(state.venues[0].ownCode.updatedAt,'2026-10-16T18:04:00.000Z');
  assert.deepEqual(state.venues[0].publicReports[0],otherBefore);
  assert.equal(state.venues[0].saved,true);
  assert.equal('deleteDemoCode' in demo,false);
});

test('equal code text never merges reports or transfers another submitter ownership', () => {
  const initial=demo.createDemoState();
  const otherBefore={...initial.venues[0].publicReports[0]};
  let state=demo.saveDemoCode(initial,id,'3434','public',now);
  const reports=demo.visibleDemoCodes(state.venues[0],'owner');
  assert.deepEqual(reports.map(report=>report.code),['3434','3434']);
  assert.equal(new Set(reports.map(report=>report.reportID)).size,2);
  assert.deepEqual(reports.map(report=>report.canEdit),[true,false]);
  state=demo.verifyDemoCode(state,id,ownID,'2026-10-16T18:05:00.000Z');
  assert.equal(state.venues[0].ownCode.verifiedAt,'2026-10-16T18:05:00.000Z');
  assert.deepEqual(state.venues[0].publicReports[0],otherBefore);
});

test('new local codes belong to their submitter and start without invented ratings or public reports', () => {
  const initial=demo.createDemoState();
  const input={name:'My local sample',address:'112 W 34th St, New York',latitude:40.749814,longitude:-73.989081,isPublic:false,isAccessible:false,code:'0012',visibility:'private'};
  const state=demo.addDemoVenue(initial,input,now);
  assert.equal(initial.venues.length,1);
  assert.equal(state.venues.length,2);
  assert.equal(state.venues[1].saved,true);
  assert.equal(state.venues[1].ownCode.code,'0012');
  assert.notEqual(state.venues[1].ownCode.reportID,ownID);
  assert.deepEqual(state.venues[1].publicReports,[]);
  assert.deepEqual(demo.demoRating(state.venues[1]),{average:null,count:0});
  assert.equal(demo.visibleDemoCodes(state.venues[1],'owner')[0].canEdit,true);
  assert.deepEqual(demo.visibleDemoCodes(state.venues[1],'public'),[]);
  assert.equal(demo.matchesDemoFilter(state.venues[1],'clean'),false);
  assert.throws(()=>demo.addDemoVenue(initial,{...input,latitude:0},now));
  assert.throws(()=>demo.addDemoVenue(initial,{...input,name:''},now));
  assert.throws(()=>demo.addDemoVenue(initial,{...input,code:'private\ncode'},now));
});
