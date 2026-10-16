import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const modelURL=moduleURL(await readFile(new URL('../lib/geocoding-model.ts',import.meta.url),'utf8'));
const model=await import(modelURL);
const clientSource=(await readFile(new URL('../lib/geocoding.ts',import.meta.url),'utf8')).replaceAll('"@/lib/geocoding-model"',JSON.stringify(modelURL));
const client=await import(moduleURL(clientSource));
const feature=(label='123 Broadway, Manhattan, New York, NY',coordinates=[-73.9626,40.8075],extra={})=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{label,...extra}});
const results=(features=[feature()])=>({type:'FeatureCollection',features});
const jsonResponse=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

test('address query normalization stays bounded and does not echo rejected private text',()=>{
 assert.equal(model.normalizeAddressQuery('  123\n Broadway  '),'123 Broadway');
 for(const value of ['','ab','x'.repeat(241),null,{},'private-query\u0000'])assert.throws(()=>model.normalizeAddressQuery(value),error=>!error.message.includes('private-query'));
});

test('GeoJSON uses lon/lat order and explicit source; lookup does not invent venue or restroom facts',()=>{
 const [address]=model.decodeGeoSearchSuggestions(results([feature(undefined,[-73.9626,40.8075],{gid:'nycpad:address:one',name:'123 Broadway',distance:999})]));
 assert.equal(address.longitude,-73.9626);assert.equal(address.latitude,40.8075);assert.equal(address.id,'nycpad:address:one');
 assert.equal(address.source,'NYC GeoSearch');assert.equal('distanceMeters'in address,false);assert.equal('name'in address,false);assert.equal('restroom'in address,false);
});

test('malformed, missing, out-of-area or string coordinates never become suggestions',()=>{
 const invalid=[null,{},feature('Wrong order',[40.8075,-73.9626]),feature('Out of area',[-74.3,40.8]),feature('String',['-73.96',40.8]),feature('Missing',[]),feature('Infinite',[-73.96,Infinity]),{...feature(),geometry:{type:'LineString',coordinates:[[-73.96,40.8]]}},feature('x'.repeat(241)),feature('bad\u0000address')];
 assert.equal(model.decodeGeoSearchSuggestions(results(invalid)).length,0);
 assert.throws(()=>model.decodeGeoSearchSuggestions({features:[]}));
 assert.throws(()=>model.decodeGeoSearchSuggestions({type:'FeatureCollection',features:{}}));
 assert.deepEqual(model.decodeGeoSearchSuggestions(results([])),[]);
});

test('duplicates collapse by identity and location while results remain limited to six',()=>{
 const first=feature('123 Broadway',[-73.9626,40.8075],{gid:'one'});
 const data=[first,{...first},feature('123 BROADWAY',[-73.9626,40.8075],{gid:'other'}),feature('Different label',[-73.9625,40.8076],{gid:'one'}),...Array.from({length:12},(_,i)=>feature(`Address ${i}`,[-73.96+i*.001,40.8]))];
 const decoded=model.decodeGeoSearchSuggestions(results(data));
 assert.equal(decoded.length,6);assert.equal(decoded[0].label,'123 Broadway');assert.equal(new Set(decoded.map(row=>row.id)).size,6);
});

test('nearby distances are computed from returned points, not an untrusted provider distance',()=>{
 const [same,next]=model.decodeGeoSearchSuggestions(results([feature('At point',[-73.9626,40.8075],{distance:999}),feature('Nearby',[-73.9616,40.8075],{distance:0})]),{latitude:40.8075,longitude:-73.9626});
 assert.equal(same.distanceMeters,0);assert.ok(next.distanceMeters>80&&next.distanceMeters<90);
 assert.deepEqual(model.decodeGeoSearchSuggestions(results([feature('Distant NYC address',[-73.9,40.8])]),{latitude:40.8075,longitude:-73.9626}),[]);
});

test('search requests use the fixed NYC provider, six results, bounds and privacy headers',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(...args)=>{calls.push(args);return jsonResponse(results());});
 await client.searchAddresses('123 Broadway');
 assert.equal(calls.length,1);const[url,options]=calls[0],parsed=new URL(url);
 assert.equal(parsed.origin,'https://geosearch.planninglabs.nyc');assert.equal(parsed.pathname,'/v2/search');assert.equal(parsed.searchParams.get('text'),'123 Broadway');assert.equal(parsed.searchParams.get('size'),'6');
 assert.equal(parsed.searchParams.get('boundary.rect.min_lat'),'40.49');assert.equal(parsed.searchParams.get('boundary.rect.max_lon'),'-73.68');
 assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');
});

test('nearby requests use reverse coordinates only; invalid input never makes a network call',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(...args)=>{calls.push(args);return jsonResponse(results());});
 await client.nearbyAddresses({latitude:40.8075,longitude:-73.9626});
 const url=new URL(calls[0][0]);assert.equal(url.pathname,'/v2/reverse');assert.equal(url.searchParams.get('point.lat'),'40.8075');assert.equal(url.searchParams.get('point.lon'),'-73.9626');assert.equal(url.searchParams.get('text'),null);
 await assert.rejects(client.nearbyAddresses({latitude:42,longitude:-73.96}));await assert.rejects(client.searchAddresses('ab'));assert.equal(calls.length,1);
});

test('provider failures and malformed bodies never expose query or coordinate contents in errors',async t=>{
 const sentinel='private-query-sentinel';let response=()=>new Response(sentinel,{status:503});t.mock.method(globalThis,'fetch',async()=>response());
 await assert.rejects(client.searchAddresses(sentinel),error=>!error.message.includes(sentinel));
 response=()=>new Response(sentinel);await assert.rejects(client.searchAddresses(sentinel),error=>!error.message.includes(sentinel));
 response=()=>new Response('x'.repeat(150001));await assert.rejects(client.searchAddresses(sentinel),error=>!error.message.includes(sentinel));
});

test('external cancellation aborts its request and is distinguishable from a provider error',async t=>{
 let calls=0,receivedSignal;const controller=new AbortController();
 t.mock.method(globalThis,'fetch',async(_url,options)=>{calls++;receivedSignal=options.signal;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('provider request aborted')),{once:true}));});
 const pending=client.searchAddresses('123 Broadway',{signal:controller.signal});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(receivedSignal.aborted,true);
 await assert.rejects(client.searchAddresses('123 Broadway',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
});

test('an eight-second deadline aborts slow lookup without leaving the picker pending',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let receivedSignal;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{receivedSignal=options.signal;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('private-provider-detail')),{once:true}));});
 const pending=client.searchAddresses('123 Broadway');t.mock.timers.tick(8000);
 await assert.rejects(pending,error=>error.name!=='AbortError'&&error.message.includes('too long')&&!error.message.includes('private-provider-detail'));assert.equal(receivedSignal.aborted,true);
});
