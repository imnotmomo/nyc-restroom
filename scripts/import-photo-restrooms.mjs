/** Administrator-only, create-only import. No credentials or source photos belong in Git. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { normalizeCommunityRestroomInput } from '../lib/community-restroom-model.ts';
import { normalizePasscodeInput } from '../lib/passcode-model.ts';

const PROJECT='nye-restroom', DATABASE='(default)', SERVICE_OWNER='system-photo-import';
const ROOT=`projects/${PROJECT}/databases/${DATABASE}/documents`;
const hash=text=>createHash('sha256').update(text).digest('hex');
const id20=text=>hash(text).slice(0,20);
const canonical=text=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const venueIdentity=data=>canonical(data.name)+'|'+canonical(data.address);
const stable=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))):entry);
const args=Object.fromEntries(process.argv.slice(2).map((arg,index,all)=>arg.startsWith('--')?[arg.slice(2),all[index+1]?.startsWith('--')?true:all[index+1]??true]:[]).filter(pair=>pair.length));
if(!args.manifest||!args.report||!args.snapshot||!args['firebase-tools-dir'])throw new Error('Required: --manifest --snapshot --report --firebase-tools-dir; optional --apply --expected-sha');
const manifestText=await readFile(resolve(args.manifest),'utf8'), manifestHash=hash(manifestText);
const manifest=JSON.parse(manifestText);
if(manifest.project!==PROJECT||manifest.database!==DATABASE||!Array.isArray(manifest.venues)||!Array.isArray(manifest.codes)||!Array.isArray(manifest.sourceRows))throw new Error('Invalid import manifest or wrong database.');
if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(manifest.batchID))throw new Error('Invalid batch ID.');
if(!Array.isArray(manifest.sourceImages)||!manifest.sourceImages.length||new Set(manifest.sourceImages).size!==manifest.sourceImages.length||manifest.sourceImages.some(name=>typeof name!=='string'||!/^[0-9]+-Photo-[0-9]+\.jpg$/.test(name)))throw new Error('Invalid source-image inventory.');
if(args.apply&&args['expected-sha']!==manifestHash)throw new Error('Apply requires the exact independently reviewed manifest SHA.');
const city=JSON.parse(await readFile(new URL('../data/nyc-restrooms/restrooms.json',import.meta.url),'utf8')).restrooms;
const knownCity=new Set(city.map(place=>place.id));
const newPlaces=new Map();
for(const venue of manifest.venues){
  if(!/^community-[a-f0-9]{20}$/.test(venue.id)||newPlaces.has(venue.id))throw new Error('Invalid or repeated venue ID.');
  const payload=normalizeCommunityRestroomInput(venue.payload);
  if(payload.observedOn!==null||payload.stepFreeAccess!=='unknown'||/\p{Script=Han}/u.test(payload.name+payload.address+payload.notes))throw new Error('Imported records must have English text and unknown observation/route dates.');
  if(!payload.notes.includes('source date unknown')||!payload.notes.includes('Not independently verified'))throw new Error('An import source caveat is missing.');
  if(venue.canonicalIdentity!==venueIdentity(payload)||venue.id!==`community-${id20(venue.canonicalIdentity)}`)throw new Error('Venue identity/hash mismatch.');
  newPlaces.set(venue.id,payload);
}
const desiredCodes=new Set();
for(const code of manifest.codes){
  if(!knownCity.has(code.placeID)&&!newPlaces.has(code.placeID))throw new Error('Code targets an unknown place.');
  if(normalizePasscodeInput({code:code.code,visibility:'public'}).code!==code.code)throw new Error('Unnormalized code.');
  if(code.reportID!==id20(code.placeID+'|'+code.code))throw new Error('Report hash mismatch.');
  const key=code.placeID+'|'+code.code;if(desiredCodes.has(key))throw new Error('Duplicate code in manifest.');desiredCodes.add(key);
}
const sourceIDs=new Set();
for(const source of manifest.sourceRows){
  if(!manifest.sourceImages.includes(source.sourceImage)||typeof source.sourceRow!=='string'||!source.sourceRow||source.sourceRow.length>80||/[\x00-\x1f/]/.test(source.sourceRow))throw new Error('Invalid source row reference.');
  if(source.id!==id20(source.sourceImage+'|'+source.sourceRow)||/\p{Script=Han}/u.test(JSON.stringify(source)))throw new Error('Invalid source identity or untranslated source field.');
  if(sourceIDs.has(source.id))throw new Error('Duplicate source row ID.');sourceIDs.add(source.id);
}

// Reuse the configured Firebase CLI login in memory. Never print or export its tokens.
const cliRequire=createRequire(pathToFileURL(resolve(args['firebase-tools-dir'],'package.json')));
const auth=cliRequire('./lib/auth.js'), {requireAuth}=cliRequire('./lib/requireAuth.js'), {Client}=cliRequire('./lib/apiv2.js');
const account=auth.getGlobalDefaultAccount();if(!account)throw new Error('Use the project Firebase CLI login first.');
const authOptions={project:PROJECT};auth.setActiveAccount(authOptions,account);await requireAuth(authOptions);
const api=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const database=(await api.get(`/projects/${PROJECT}/databases/${DATABASE}`)).body;
if(database.databaseEdition!=='STANDARD'||database.name!==`projects/${PROJECT}/databases/${DATABASE}`)throw new Error('Unexpected database identity/edition.');
const list=async path=>{
  const result=[];let pageToken;
  do{const response=(await api.get(`/${ROOT}/${path}`,{queryParams:{pageSize:1000,...(pageToken?{pageToken}:{})}})).body;result.push(...response.documents??[]);pageToken=response.nextPageToken;}while(pageToken);
  return result;
};
const get=async path=>{try{return(await api.get(`/${ROOT}/${path}`)).body;}catch(error){if(error.status===404||error.context?.response?.statusCode===404||error.context?.body?.error?.code===404)return null;throw error;}};
const decode=value=>{
  if('stringValue'in value)return value.stringValue;if('integerValue'in value)return Number(value.integerValue);if('doubleValue'in value)return value.doubleValue;
  if('nullValue'in value)return null;if('booleanValue'in value)return value.booleanValue;if('timestampValue'in value)return value.timestampValue;
  if('arrayValue'in value)return(value.arrayValue.values??[]).map(decode);if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields??{}).map(([key,entry])=>[key,decode(entry)]));throw new Error('Unsupported stored value.');
};
const dataOf=document=>Object.fromEntries(Object.entries(document.fields??{}).map(([key,value])=>[key,decode(value)]));
const encode=value=>{
  if(value===null)return{nullValue:null};if(typeof value==='string')return{stringValue:value};if(typeof value==='boolean')return{booleanValue:value};
  if(typeof value==='number')return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
  if(Array.isArray(value))return{arrayValue:{values:value.map(encode)}};
  if(value&&typeof value==='object')return{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,encode(entry)]))}};
  throw new Error('Unsupported import value.');
};
const create=(path,fields,timeFields=[])=>({update:{name:`${ROOT}/${path}`,fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,encode(value)]))},currentDocument:{exists:false},...(timeFields.length?{updateTransforms:timeFields.map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))}:{})});
const existingPlaces=await list('communityRestrooms');
const existingIdentity=new Map(existingPlaces.map(document=>[venueIdentity(dataOf(document)),document.name.split('/').at(-1)]));
const savedReads=[...existingPlaces];const groups=[];const counters={venuesCreated:0,venuesAlreadyPresent:0,codesCreated:0,codesAlreadyPresent:0,sourceRowsCreated:0,sourceRowsAlreadyPresent:0};
for(const venue of manifest.venues){
  const collision=existingIdentity.get(venueIdentity(venue.payload));
  if(collision&&collision!==venue.id)throw new Error('An existing random-ID community listing matches this venue; merge the manifest before applying.');
  const existing=existingPlaces.find(document=>document.name.split('/').at(-1)===venue.id);
  if(existing){const {submittedAt,...stored}=dataOf(existing);if(stable(stored)!==stable(newPlaces.get(venue.id)))throw new Error('Existing import venue payload differs; stop for review.');counters.venuesAlreadyPresent++;continue;}
  const [receipt,summary]=await Promise.all([get(`restroomSubmissions/${venue.id}`),get(`restroomRatingSummaries/${venue.id}`)]);
  if(receipt||summary)throw new Error('Orphaned prior venue metadata requires review; do not overwrite it.');
  groups.push([create(`communityRestrooms/${venue.id}`,newPlaces.get(venue.id),['submittedAt']),create(`restroomSubmissions/${venue.id}`,{ownerUID:SERVICE_OWNER},['submittedAt']),create(`restroomRatingSummaries/${venue.id}`,{ratingCount:0,ratingSum:0},['updatedAt'])]);counters.venuesCreated++;
}
const reportsByPlace=new Map();
for(const code of manifest.codes){
  if(!reportsByPlace.has(code.placeID)){
    const reports=await list(`restroomPasscodeReports/${code.placeID}/reports`);reportsByPlace.set(code.placeID,reports);savedReads.push(...reports);
    const newUncommitted=newPlaces.has(code.placeID)&&!existingPlaces.some(document=>document.name.split('/').at(-1)===code.placeID);
    if(!newUncommitted){
      const summary=await get(`restroomRatingSummaries/${code.placeID}`);
      if(!summary)throw new Error('An existing place needs rating-summary initialization and review before adding codes.');
      const summaryData=dataOf(summary);if(!Number.isInteger(summaryData.ratingCount)||summaryData.ratingCount<0||!Number.isFinite(summaryData.ratingSum)||summaryData.ratingSum<0)throw new Error('Existing rating summary is malformed.');savedReads.push(summary);
    }
  }
  const reports=reportsByPlace.get(code.placeID);
  if(reports.some(document=>{
    const data=dataOf(document),fields=Object.keys(data).sort().join(',');
    if(data.placeID!==code.placeID||fields!=='code,codeUpdatedAt,lastVerifiedAt,placeID'||!/^[A-Za-z0-9]{20}$/.test(document.name.split('/').at(-1))||normalizePasscodeInput({code:data.code,visibility:'public'}).code!==data.code||!document.fields.codeUpdatedAt?.timestampValue||!Number.isFinite(Date.parse(data.codeUpdatedAt))||(data.lastVerifiedAt!==null&&(!document.fields.lastVerifiedAt?.timestampValue||!Number.isFinite(Date.parse(data.lastVerifiedAt))||Date.parse(data.lastVerifiedAt)<Date.parse(data.codeUpdatedAt))))throw new Error('A stored public report has an invalid schema or place identity.');
    return data.code===code.code;
  })){counters.codesAlreadyPresent++;continue;}
  if(reports.some(document=>document.name.split('/').at(-1)===code.reportID))throw new Error('Existing report ID contains a different code; stop for review.');
  const reservation=await get(`restroomPasscodeOwners/${code.reportID}`);if(reservation)throw new Error('An existing code reservation requires review.');
  groups.push([create(`restroomPasscodeReports/${code.placeID}/reports/${code.reportID}`,{placeID:code.placeID,code:code.code,lastVerifiedAt:null},['codeUpdatedAt']),create(`restroomPasscodeOwners/${code.reportID}`,{ownerUID:SERVICE_OWNER,placeID:code.placeID},['createdAt'])]);counters.codesCreated++;
}
const oldSources=await list(`photoImportSources/${manifest.batchID}/rows`);savedReads.push(...oldSources);
const oldSourcesByID=new Map(oldSources.map(document=>[document.name.split('/').at(-1),document]));
for(const source of manifest.sourceRows){
  const old=oldSourcesByID.get(source.id);
  if(old){const {importedAt,...oldData}=dataOf(old);if(stable(oldData)!==stable(source))throw new Error('Provenance immutable payload differs; stop for review.');counters.sourceRowsAlreadyPresent++;continue;}
  groups.push([create(`photoImportSources/${manifest.batchID}/rows/${source.id}`,source,['importedAt'])]);counters.sourceRowsCreated++;
}
const batchDoc=await get(`photoImportSources/${manifest.batchID}`);if(batchDoc){if(dataOf(batchDoc).manifestHash!==manifestHash)throw new Error('This batch ID already belongs to a different manifest hash.');savedReads.push(batchDoc);}
else groups.unshift([create(`photoImportSources/${manifest.batchID}`,{manifestHash,sourceImages:manifest.sourceImages,sourceRowCount:manifest.sourceRows.length,sourceDate:null,systemOwner:SERVICE_OWNER},['importedAt'])]);
// Snapshot is saved before any writes. It contains only public records and this import's private provenance.
const targetSnapshot=[], plannedPaths=groups.flat().map(write=>write.update.name.slice(ROOT.length+1));
for(let offset=0;offset<plannedPaths.length;offset+=12){
  const states=await Promise.all(plannedPaths.slice(offset,offset+12).map(async path=>({path,document:await get(path)})));
  if(states.some(state=>state.document))throw new Error('A planned create target now exists; rerun the dry run.');targetSnapshot.push(...states);
}
await writeFile(resolve(args.snapshot),JSON.stringify({project:PROJECT,database:DATABASE,capturedAt:new Date().toISOString(),manifestHash,targetSnapshot,existingDocuments:savedReads},null,2)+'\n',{mode:0o600,flag:'wx'});
const result={project:PROJECT,database:DATABASE,manifestHash,mode:args.apply?'apply':'dry-run',status:args.apply?'applying':'planned',planned:{writes:groups.reduce((sum,group)=>sum+group.length,0),...counters},committed:{venues:0,codes:0,sourceRows:0,paths:[]},batchesCommitted:0};
if(args.apply){
  // Preserve each venue's listing/receipt/summary and each code/reservation as an atomic group.
  let batch=[];
  const flush=async()=>{if(batch.length){await api.post(`/${ROOT}:commit`,{writes:batch});result.batchesCommitted++;for(const write of batch){const path=write.update.name.slice(ROOT.length+1);result.committed.paths.push(path);if(path.startsWith('communityRestrooms/'))result.committed.venues++;if(path.startsWith('restroomPasscodeReports/'))result.committed.codes++;if(path.startsWith('photoImportSources/')&&path.includes('/rows/'))result.committed.sourceRows++;}await writeFile(resolve(args.report),JSON.stringify(result,null,2)+'\n');batch=[];}};
  for(const group of groups){if(batch.length+group.length>300)await flush();batch.push(...group);}await flush();
}
result.status=args.apply?'complete':'planned';result.completedAt=new Date().toISOString();await writeFile(resolve(args.report),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,committed:{...result.committed,paths:result.committed.paths.length}}));
