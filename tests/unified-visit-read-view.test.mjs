import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';

const dataURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const modelURL=dataURL(stripTypeScriptTypes(await readFile(new URL('../lib/visit-report-model.ts',import.meta.url),'utf8')));
const model=await import(modelURL);
// Static rendering must not initialize a Firebase client, start a listener or invoke a write.
const serviceURL=dataURL(['createVisitReport','deleteVisitReport','newVisitReportID','readOwnVisitReportIDs','watchVisitReports','watchUnifiedVisitReports'].map(name=>`export function ${name}(){throw new Error('Unexpected Firebase access during static rendering');}`).join('\n'));
await loadBindings();
let source=(await transform(await readFile(new URL('../components/finder/visit-reports.tsx',import.meta.url),'utf8'),{filename:'visit-reports.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'es6'}})).code;
source=source.replace(/((?:from\s*|import\s*)["'])([^"']+)(["'])/g,(_,start,name,end)=>start+(name==='@/lib/visit-reports'?serviceURL:name==='@/lib/visit-report-model'?modelURL:import.meta.resolve(name))+end);
const view=await import(dataURL(source));
const placeID='community-ABCDEFGHIJKLMNOPQRST',id='ABCDEFGHIJKLMNOPQRST';
const wire=(change={})=>({schemaVersion:1,placeID,observedAt:new Date('2026-01-01T12:00:00Z'),submittedAt:new Date('2026-02-01T12:00:00Z'),entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',stairs:'not-reported',soap:'not-reported',toiletPaper:'not-reported',floor:'not-reported',condition:'not-reported',comment:'A dated comment.',anonymous:true,authorName:null,...change});
const unified=(change={})=>model.normalizeUnifiedVisitReport(id,placeID,wire(change),new Date('2026-10-24'));
const evidence=(change={})=>model.mergeVisitReportEvidence(placeID,[],[unified(change)])[0];
function card(entry,change={}) {return renderToStaticMarkup(React.createElement(view.VisitReportObservation,{entry,open:true,own:false,confirmingDelete:false,removing:false,busy:false,error:null,onDelete(){throw new Error('Unexpected delete');},onConfirmDelete(){throw new Error('Unexpected confirmation');},onKeep(){throw new Error('Unexpected cancellation');},...change}));}

test('actual card renders Anonymous and distinct visit/posting times for unified observations',()=>{
  const html=card(evidence());assert.match(html,/Anonymous/);assert.match(html,/A dated comment/);
  assert.ok(html.includes('2026-01-01T12:00:00.000Z'));assert.ok(html.includes('2026-02-01T12:00:00.000Z'));
  assert.match(html,/Not reported/);assert.doesNotMatch(html,/Your report|Remove my report/);
});
test('chosen public name and comment stay escaped text rather than HTML, links or scripts',()=>{
  const html=card(evidence({anonymous:false,authorName:'<b>A Visitor</b>',comment:'<script>alert("text")</script> https://example.org/'}));
  assert.match(html,/&lt;b&gt;A Visitor&lt;\/b&gt;/);assert.match(html,/&lt;script&gt;/);assert.match(html,/https:\/\/example.org/);
  assert.doesNotMatch(html,/<script|<b>|<a\b|href=/);
});
test('dated unified card displays observed amenity yes and no answers without inferring accessibility',()=>{
  const html=card(evidence({elevatorPresent:'yes',automaticDoorPresent:'no'}));
  assert.match(html,/<dt>Elevator present<\/dt><dd>Yes — reported<\/dd>/);
  assert.match(html,/<dt>Automatic door present<\/dt><dd>No — reported<\/dd>/);
  assert.ok(html.includes('2026-01-01T12:00:00.000Z'));
  assert.doesNotMatch(html,/<dt>Accessible|Wheelchair accessible/);
});
test('absent and unknown amenities stay omitted and a legacy entry cannot inherit unified amenity fields',()=>{
  for(const change of [{},{elevatorPresent:'not-reported',automaticDoorPresent:'not-reported'}]) {
    assert.doesNotMatch(card(evidence(change)),/<dt>Elevator present|<dt>Automatic door present/);
  }
  const report=unified({elevatorPresent:'yes',automaticDoorPresent:'no'});
  const legacy=model.mergeVisitReportEvidence(placeID,[report],[])[0];
  assert.doesNotMatch(card(legacy),/<dt>Elevator present|<dt>Automatic door present/);
});
test('a same-ID legacy ownership flag never exposes unified removal or ownership labels',()=>{
  const report=unified();const rows=model.mergeVisitReportEvidence(placeID,[report],[report]);
  const newRow=rows.find(row=>row.source==='unified');const oldRow=rows.find(row=>row.source==='legacy');
  assert.doesNotMatch(card(newRow,{own:true,confirmingDelete:true}),/Your report|Remove report|Remove my report/);
  assert.match(card(oldRow,{own:true}),/Your report/);assert.match(card(oldRow,{own:true}),/Remove my report/);
});
test('initial full component waits for both report feeds without initializing Firebase in SSR',()=>{
  const html=renderToStaticMarkup(React.createElement(view.VisitReports,{placeID,uid:null,accountLoading:false,configured:true,authError:null,onSignIn(){throw new Error('Unexpected sign-in');}}));
  assert.match(html,/Loading recent visitor reports/);assert.doesNotMatch(html,/No public visit reports yet/);assert.match(html,/Sign in with Google to share a visit/);
});
