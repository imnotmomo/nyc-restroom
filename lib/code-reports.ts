import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection, doc, getFirestore, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, where,
  type DocumentData, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError, type FirebaseClient } from "@/lib/firebase-client";
import { normalizePasscodeInput, MAX_PASSCODE_LENGTH, type PasscodeInput } from "@/lib/passcode-model";
import { codeVersionParts, compareCodeVersions, sortedCodeEvidence, type CodeEvidence, type CodeEvidenceState, type CodeKind, type CodeVisibility, type CodeVote } from "@/lib/code-evidence-model";
export { MAX_PASSCODE_LENGTH };
export type { CodeEvidence, CodeEvidenceState, CodeKind, CodeVisibility, CodeVote } from "@/lib/code-evidence-model";

class CodeError extends Error {}
type Scope = { client: FirebaseClient; uid: string; user: User };
type RecordData = { kind: CodeKind; placeID: string; reportID: string; code: string; version: Timestamp; created: Timestamp | null; verified: Timestamp | null; visibility: CodeVisibility };
type Feedback = { version: Timestamp; used: number; invalid: number; lastUsed: Timestamp | null; updated: Timestamp };
type Vote = { version: Timestamp; vote: CodeVote; updated: Timestamp };
const LIMIT = 10;
const exact = (data: DocumentData, keys: readonly string[]) => Object.keys(data).length === keys.length && keys.every(key => Object.hasOwn(data, key));
function fail(message = "Code details could not be confirmed. Refresh before retrying the same request."): never { throw new CodeError(message); }
function requireClient(): FirebaseClient {
  const client = getFirebaseClient();
  if (!client) fail(getFirebaseConfigurationError() ?? "Restroom codes are not connected in this build.");
  return client;
}
function account(uid: string): Scope {
  const client = requireClient(), user = client.auth.currentUser;
  if (!uid || !user || user.isAnonymous || user.uid !== uid) fail("Sign in to report or check a restroom code.");
  const scope = { client, uid, user }; check(scope); return scope;
}
function check(scope: Scope): void {
  if (scope.client.auth.currentUser !== scope.user || scope.user.uid !== scope.uid || scope.user.isAnonymous) fail("Your account changed. Return to the original account and retry the same request.");
}
function readable(error: unknown): Error {
  if (error instanceof CodeError) return error;
  return new CodeError("The code request could not be confirmed. Refresh your account and retry the same draft; no change has been confirmed.");
}
function place(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:._~-]{0,127}$/.test(value) || (value.startsWith("community-") && !/^community-[A-Za-z0-9]{20}$/.test(value))) fail("Choose a restroom from the map first.");
}
function reportID(value: string): void { if (!/^[A-Za-z0-9]{20}$/.test(value)) fail("Reopen the code form before starting a new report."); }
const version = (value: Timestamp) => `${value.seconds}:${value.nanoseconds}`;
function time(value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) fail();
  try { codeVersionParts(version(value)); } catch { fail(); }
  if (value.toMillis() > Date.now()) fail("A code date is in the future. Refresh its details before using it.");
  return value;
}
function optionalTime(value: unknown, after: Timestamp, before?: Timestamp): Timestamp | null {
  if (value === null) return null;
  const result = time(value);
  if (compareCodeVersions(version(result), version(after)) < 0 || before && compareCodeVersions(version(result), version(before)) > 0) fail();
  return result;
}
function code(value: unknown): string {
  try { const result = normalizePasscodeInput({ code: value, visibility: "private" }).code; if (result !== value) fail(); return result; } catch { return fail(); }
}
function publicRecord(kind: CodeKind, placeID: string, id: string, data: DocumentData): RecordData {
  reportID(id);
  if (!exact(data, kind === "legacy" ? ["placeID", "code", "codeUpdatedAt", "lastVerifiedAt"] : ["placeID", "code", "codeUpdatedAt"]) || data.placeID !== placeID) fail();
  const stamp = time(data.codeUpdatedAt);
  return { kind, placeID, reportID: id, code: code(data.code), version: stamp, created: null, verified: kind === "legacy" ? optionalTime(data.lastVerifiedAt, stamp) : null, visibility: "public" };
}
function ownRecord(kind: CodeKind, placeID: string, id: string, data: DocumentData): RecordData {
  const keys = ["placeID", "code", "visibility", "createdAt", "codeUpdatedAt", "lastVerifiedAt"];
  if (!exact(data, kind === "legacy" ? [...keys, "reportID"] : keys) || data.placeID !== placeID || !["private", "public"].includes(data.visibility)) fail();
  const actualID = kind === "legacy" ? data.reportID : id; reportID(actualID);
  const stamp = time(data.codeUpdatedAt), created = time(data.createdAt);
  if (compareCodeVersions(version(created), version(stamp)) > 0 || kind === "v2" && !created.isEqual(stamp)) fail();
  return { kind, placeID, reportID: actualID, code: code(data.code), version: stamp, created, verified: optionalTime(data.lastVerifiedAt, stamp), visibility: data.visibility };
}
function summary(row: RecordData, data: DocumentData): Feedback {
  if (!exact(data, ["placeID", "kind", "reportID", "codeUpdatedAt", "usedCount", "invalidCount", "lastUsedAt", "updatedAt"])
    || data.placeID !== row.placeID || data.kind !== row.kind || data.reportID !== row.reportID
    || ![data.usedCount, data.invalidCount].every(n => Number.isInteger(n) && n >= 0 && n <= 1e6)) fail();
  const stamp = time(data.codeUpdatedAt), updated = time(data.updatedAt);
  if (compareCodeVersions(version(updated), version(stamp)) < 0) fail();
  return { version: stamp, used: data.usedCount, invalid: data.invalidCount, lastUsed: optionalTime(data.lastUsedAt, stamp, updated), updated };
}
function ownVote(row: RecordData, data: DocumentData): Vote {
  if (!exact(data, ["placeID", "kind", "reportID", "codeUpdatedAt", "vote", "updatedAt"]) || data.placeID !== row.placeID || data.kind !== row.kind || data.reportID !== row.reportID || !["used", "invalid"].includes(data.vote)) fail();
  const stamp = time(data.codeUpdatedAt), updated = time(data.updatedAt);
  if (compareCodeVersions(version(updated), version(stamp)) < 0) fail();
  return { version: stamp, vote: data.vote, updated };
}
const ownRef = (db: Firestore, uid: string, kind: CodeKind, p: string, id: string) => doc(db, "users", uid, kind === "legacy" ? "restroomReadyPasscodes" : "restroomReadyPasscodesV2", kind === "legacy" ? p : id);
const ownerRef = (db: Firestore, kind: CodeKind, id: string) => doc(db, kind === "legacy" ? "restroomPasscodeOwners" : "restroomPasscodeV2Owners", id);
const publicRef = (db: Firestore, kind: CodeKind, p: string, id: string) => doc(db, kind === "legacy" ? "restroomPasscodeReports" : "restroomPasscodeReportsV2", p, "reports", id);
const savedRef = (db: Firestore, uid: string, p: string) => doc(db, "users", uid, "restroomReadySaved", p);
const feedbackRef = (db: Firestore, row: RecordData) => doc(db, "restroomPasscodeFeedback", row.placeID, "codes", `${row.kind}_${row.reportID}`);
const voteRef = (db: Firestore, uid: string, row: RecordData) => doc(db, "users", uid, "restroomReadyPasscodeVotes", `${row.placeID}~${row.kind}_${row.reportID}`);
const rowID = (row: RecordData) => `${row.kind}:${row.reportID}`;
function fromExpected(expected: CodeEvidence): RecordData {
  place(expected.placeID); reportID(expected.reportID);
  if (!["legacy", "v2"].includes(expected.kind) || expected.id !== `${expected.kind}:${expected.reportID}` || !["private", "public"].includes(expected.visibility)) fail();
  const [s,n] = codeVersionParts(expected.codeVersion);
  return { kind: expected.kind, placeID: expected.placeID, reportID: expected.reportID, code: code(expected.code), version: new Timestamp(s,n), created: expected.createdVersion ? new Timestamp(...codeVersionParts(expected.createdVersion)) : null, verified: null, visibility: expected.visibility };
}
function same(current: RecordData, expected: RecordData): boolean { return current.kind === expected.kind && current.placeID === expected.placeID && current.reportID === expected.reportID && current.code === expected.code && current.version.isEqual(expected.version) && current.visibility === expected.visibility && (!expected.created || Boolean(current.created?.isEqual(expected.created))); }
function pinPublic(expected: RecordData, snapshot: DocumentSnapshot): RecordData {
  if (!snapshot.exists()) fail("This code is no longer public. Refresh the reports.");
  const current = publicRecord(expected.kind, expected.placeID, expected.reportID, snapshot.data());
  if (current.code !== expected.code || !current.version.isEqual(expected.version)) fail("This code changed. Refresh before reporting a check for its new version.");
  return current;
}
async function pair(db: Firestore, scope: Scope, kind: CodeKind, p: string, id: string): Promise<[DocumentSnapshot, DocumentSnapshot, DocumentSnapshot, DocumentSnapshot]> {
  return runTransaction(db, async transaction => { check(scope); const result = await Promise.all([transaction.get(ownRef(db, scope.uid, kind,p,id)),transaction.get(ownerRef(db,kind,id)),transaction.get(publicRef(db,kind,p,id)),transaction.get(savedRef(db,scope.uid,p))]); check(scope); return result; });
}
function checkedPair(scope: Scope, kind: CodeKind, p: string, id: string, snapshots: readonly DocumentSnapshot[]): RecordData | null {
  const [own, reservation, shared] = snapshots;
  if (!own.exists() && !reservation.exists() && !shared.exists()) return null;
  if (!own.exists() || !reservation.exists()) fail("An earlier code report needs checking. Retry the same report.");
  const row = ownRecord(kind,p,id,own.data()), owner = reservation.data();
  if (!exact(owner,["ownerUID","placeID","createdAt"]) || owner.ownerUID !== scope.uid || owner.placeID !== p || !time(owner.createdAt).isEqual(row.created!)) fail();
  if (row.visibility === "private" ? shared.exists() : !shared.exists()) fail();
  if (shared.exists() && !same(publicRecord(kind,p,id,shared.data()), {...row,visibility:"public",created:null})) fail();
  return row;
}
function validSaved(snapshot:DocumentSnapshot, p:string):boolean {
  if(!snapshot.exists())return false;const value=snapshot.data();
  if(!exact(value,["placeID","savedAt"])||value.placeID!==p)fail("Your saved place could not be confirmed.");time(value.savedAt);return true;
}
function confirmSavedPair(scope:Scope,kind:CodeKind,p:string,id:string,snapshots:readonly DocumentSnapshot[]):RecordData|null {
  const row=checkedPair(scope,kind,p,id,snapshots);if(row?.visibility === "private"&&!validSaved(snapshots[3],p))fail("Your code was saved, but its Saved-place confirmation is unavailable. Retry the same request.");return row;
}
export function newCodeReportID(): string { return doc(collection(getFirestore(requireClient().app),"restroomPasscodeV2Owners")).id; }

export async function reportNewCode(uid: string, placeID: string, id: string, input: PasscodeInput): Promise<void> {
  place(placeID); reportID(id); const fields = normalizePasscodeInput(input), scope = account(uid), db = getFirestore(scope.client.app);
  const read = () => pair(db,scope,"v2",placeID,id);
  const matches = (row: RecordData | null) => row && row.code === fields.code && row.visibility === fields.visibility;
  try {
    await runTransaction(db,async transaction => {
      check(scope); const refs=[ownRef(db,uid,"v2",placeID,id),ownerRef(db,"v2",id),publicRef(db,"v2",placeID,id)];
      const snaps=await Promise.all(refs.map(ref=>transaction.get(ref))); check(scope);
      const saved=fields.visibility === "private" ? await transaction.get(savedRef(db,uid,placeID)) : null; check(scope);
      const before=checkedPair(scope,"v2",placeID,id,snaps);
      if(before){if(!matches(before))fail("This report was already saved with different details. Start a new report for a changed code.");if(fields.visibility === "private"&&!validSaved(saved!,placeID))transaction.set(savedRef(db,uid,placeID),{placeID,savedAt:serverTimestamp()});check(scope);return;}
      if(saved?.exists())validSaved(saved,placeID);
      transaction.set(refs[0],{placeID,...fields,createdAt:serverTimestamp(),codeUpdatedAt:serverTimestamp(),lastVerifiedAt:null});
      transaction.set(refs[1],{ownerUID:uid,placeID,createdAt:serverTimestamp()});
      if(fields.visibility === "public")transaction.set(refs[2],{placeID,code:fields.code,codeUpdatedAt:serverTimestamp()});
      else if(!saved?.exists())transaction.set(savedRef(db,uid,placeID),{placeID,savedAt:serverTimestamp()});
      check(scope);
    });
    check(scope);if(!matches(confirmSavedPair(scope,"v2",placeID,id,await read())))fail();
  } catch(error){check(scope);if(!(error instanceof CodeError)){try{if(matches(confirmSavedPair(scope,"v2",placeID,id,await read())))return;}catch{check(scope);}}throw readable(error);}
}

async function mutateOwned(uid: string, expected: CodeEvidence, action: "visibility" | "delete" | "verify", visibility?: CodeVisibility): Promise<void> {
  const pinned=fromExpected(expected), scope=account(uid),db=getFirestore(scope.client.app);
  if(expected.ownership !== "own" || !pinned.created)fail("Load your own code before changing it.");
  if(action === "visibility" && !["private","public"].includes(visibility!))fail();
  const refs=[ownRef(db,uid,pinned.kind,pinned.placeID,pinned.reportID),ownerRef(db,pinned.kind,pinned.reportID),publicRef(db,pinned.kind,pinned.placeID,pinned.reportID)];
  let attemptedVerification=false, previousVerified:Timestamp|null=null;
  async function confirm(): Promise<void> {
    const snaps=await pair(db,scope,pinned.kind,pinned.placeID,pinned.reportID);check(scope);
    const current=confirmSavedPair(scope,pinned.kind,pinned.placeID,pinned.reportID,snaps);
    if(action === "delete"){if(current)fail();return;}
    if(!current || !same({...current,visibility:pinned.visibility},pinned))fail();
    if(action === "visibility" && current.visibility !== visibility)fail();
    if(action === "verify" && (current.visibility !== "private" || !current.verified || !attemptedVerification || previousVerified && compareCodeVersions(version(current.verified),version(previousVerified))<=0))fail();
  }
  try {
    await runTransaction(db,async transaction=>{
      check(scope);const snaps=await Promise.all(refs.map(ref=>transaction.get(ref)));check(scope);
      const current=checkedPair(scope,pinned.kind,pinned.placeID,pinned.reportID,snaps);
      if(!current){if(action === "delete")return;fail();}
      if(action === "visibility" && current.visibility === visibility && same({...current,visibility:pinned.visibility},pinned)){
        if(visibility === "private"){const saved=await transaction.get(savedRef(db,uid,pinned.placeID));check(scope);if(!validSaved(saved,pinned.placeID))transaction.set(savedRef(db,uid,pinned.placeID),{placeID:pinned.placeID,savedAt:serverTimestamp()});}
        check(scope);return;
      }
      if(!same(current,pinned))fail("Your code or its visibility changed. Refresh before trying again.");
      const privateAfter=action === "verify" || action === "visibility" && visibility === "private";
      const saved=privateAfter?await transaction.get(savedRef(db,uid,pinned.placeID)):null;check(scope);if(saved?.exists())validSaved(saved,pinned.placeID);
      if(action === "delete"){transaction.delete(refs[0]);transaction.delete(refs[1]);if(snaps[2].exists())transaction.delete(refs[2]);}
      else if(action === "verify"){
        if(current.visibility !== "private")fail("Only other visitors can check your public code.");
        previousVerified=current.verified;attemptedVerification=true;transaction.update(refs[0],{lastVerifiedAt:serverTimestamp()});
      } else if(current.visibility !== visibility){
        const verified=current.kind === "legacy" && snaps[2].exists()?snaps[2].data()!.lastVerifiedAt:snaps[0].data()!.lastVerifiedAt;
        transaction.update(refs[0],{visibility,...(current.kind === "legacy"?{lastVerifiedAt:verified}:{})});
        if(visibility === "private")transaction.delete(refs[2]);
        else transaction.set(refs[2],{placeID:current.placeID,code:current.code,codeUpdatedAt:current.version,...(current.kind === "legacy"?{lastVerifiedAt:verified}:{})});
      }
      if(privateAfter&&!saved?.exists())transaction.set(savedRef(db,uid,pinned.placeID),{placeID:pinned.placeID,savedAt:serverTimestamp()});
      check(scope);
    });
    check(scope);await confirm();
  }catch(error){check(scope);if(!(error instanceof CodeError)){try{await confirm();return;}catch{check(scope);}}throw readable(error);}
}
export const setCodeVisibility=(uid:string,expected:CodeEvidence,visibility:CodeVisibility)=>mutateOwned(uid,expected,"visibility",visibility);
export const deleteCodeReport=(uid:string,expected:CodeEvidence)=>mutateOwned(uid,expected,"delete");
export const verifyPrivateCode=(uid:string,expected:CodeEvidence)=>mutateOwned(uid,expected,"verify");

export async function setCodeFeedback(uid: string, expected: CodeEvidence, next: CodeVote): Promise<void> {
  const row=fromExpected(expected),scope=account(uid),db=getFirestore(scope.client.app);
  if(expected.visibility !== "public" || expected.ownership !== "other" || !["used","invalid"].includes(next))fail("Load a public code from another visitor before checking it.");
  const refs=[publicRef(db,row.kind,row.placeID,row.reportID),feedbackRef(db,row),voteRef(db,uid,row)];
  const read=(transaction:Transaction)=>Promise.all(refs.map(ref=>transaction.get(ref)));
  for(let attempt=0;attempt<3;attempt++){
    let attempted=false,beforeSummary:Timestamp|null=null,beforeVote:Timestamp|null=null;
    const coherent=async()=>runTransaction(db,async transaction=>{check(scope);const result=await read(transaction);check(scope);pinPublic(row,result[0]);return result;});
    const decode=(snaps:DocumentSnapshot[])=>{pinPublic(row,snaps[0]);return {s:snaps[1].exists()?summary(row,snaps[1].data()!):null,v:snaps[2].exists()?ownVote(row,snaps[2].data()!):null};};
    const advanced=(a:Timestamp|null,b:Timestamp|null)=>Boolean(a&&(!b||compareCodeVersions(version(a),version(b))>0));
    const confirmed=(snaps:DocumentSnapshot[])=>{const{s,v}=decode(snaps);return Boolean(s?.version.isEqual(row.version)&&v?.version.isEqual(row.version)&&v.vote===next&&advanced(v.updated,beforeVote));};
    try{
      await runTransaction(db,async transaction=>{
        check(scope);const snaps=await read(transaction);check(scope);const{s,v}=decode(snaps);
        const currentS=s?.version.isEqual(row.version)?s:null,currentV=v?.version.isEqual(row.version)?v:null;
        if(currentV&&!currentS)fail("Your code feedback needs checking. Refresh before retrying.");
        const used=(currentS?.used??0)-(currentV?.vote === "used"?1:0)+(next === "used"?1:0);
        const invalid=(currentS?.invalid??0)-(currentV?.vote === "invalid"?1:0)+(next === "invalid"?1:0);
        if(![used,invalid].every(n=>Number.isInteger(n)&&n>=0&&n<=1e6))fail();
        beforeSummary=s?.updated??null;beforeVote=v?.updated??null;attempted=true;
        transaction.set(refs[1],{placeID:row.placeID,kind:row.kind,reportID:row.reportID,codeUpdatedAt:row.version,usedCount:used,invalidCount:invalid,lastUsedAt:next === "used"?serverTimestamp():currentS?.lastUsed??null,updatedAt:serverTimestamp()});
        transaction.set(refs[2],{placeID:row.placeID,kind:row.kind,reportID:row.reportID,codeUpdatedAt:row.version,vote:next,updatedAt:serverTimestamp()});check(scope);
      });
      check(scope);if(!confirmed(await coherent()))fail();return;
    }catch(error){
      check(scope);let latest:DocumentSnapshot[];try{latest=await coherent();}catch{check(scope);throw readable(error);}
      if(attempted&&confirmed(latest))return;
      const{s,v}=decode(latest),errorCode=typeof error === "object"&&error!==null&&"code"in error?String(error.code).replace(/^firestore\//,""):"";
      if(!(error instanceof CodeError)&&attempted&&attempt<2&&errorCode === "permission-denied"&&(advanced(s?.updated??null,beforeSummary)||advanced(v?.updated??null,beforeVote)))continue;
      throw readable(error);
    }
  }
  fail("Code feedback changed repeatedly. Refresh before retrying the same check.");
}

/** Bounded public feeds and exact owner/feedback GET listeners, scoped to one place/account. */
export function watchCodeEvidence(placeID: string, uid: string | null, onChange: (state: CodeEvidenceState) => void): () => void {
  let active=true;const stops:(()=>void)[]=[],detailStops:(()=>void)[]=[];
  let detailGeneration=0;
  const publicRows=new Map<CodeKind,RecordData[]>(),ownRows=new Map<CodeKind,RecordData[]>();
  const publicReady=new Set<CodeKind>(),ownReady=new Set<CodeKind>();
  const publicErrors=new Map<CodeKind,string>(),ownErrors=new Map<CodeKind,string>();
  const sums=new Map<string,Feedback|null>(),votes=new Map<string,Vote|null>(),ownership=new Map<string,RecordData|null>();
  const sumReady=new Set<string>(),voteReady=new Set<string>(),ownerReady=new Set<string>();
  let feedbackError:string|null=null,client:FirebaseClient,scope:Scope|null=null,db:Firestore,accountInvalid=false;
  function emit(){
    if(!active)return;
    if(scope&&!accountInvalid){try{check(scope);}catch{accountInvalid=true;ownRows.clear();ownership.clear();votes.clear();ownErrors.set("v2","Your account changed. Refresh before loading private codes.");}}
    const records:CodeEvidence[]=[];
    const all=[...publicRows.values()].flat();
    for(const row of [...ownRows.values()].flat())if(!all.some(other=>rowID(other)===rowID(row)))all.push(row);
    for(const row of all){
      const key=rowID(row),owned=accountInvalid?null:[...ownRows.values()].flat().find(other=>rowID(other)===key)??ownership.get(key)??null;
      const s=sums.get(key),currentS=s?.version.isEqual(row.version)?s:null,v=votes.get(key),currentV=v?.version.isEqual(row.version)?v:null;
      const stamps=row.visibility === "private"?[row.verified]:[row.verified,currentS?.lastUsed??null];
      const verified=stamps.filter((t):t is Timestamp=>t!==null).sort((a,b)=>-compareCodeVersions(version(a),version(b)))[0]??null;
      const knownMissing=sumReady.has(key)&&s===null;
      records.push({kind:row.kind,id:key,placeID,reportID:row.reportID,code:row.code,codeVersion:version(row.version),codeUpdatedAt:row.version.toDate(),verifiedAt:verified?.toDate()??null,verifiedVersion:verified?version(verified):null,visibility:row.visibility,ownership:owned?"own":accountInvalid?"unknown":uid?(row.kind === "v2"?ownerReady.has(key):ownReady.size===2&&ownErrors.size===0)?"other":"unknown":"other",usedCount:currentS?.used??(knownMissing?0:null),invalidCount:currentS?.invalid??(knownMissing?0:null),currentVote:accountInvalid?null:currentV?.vote??null,feedbackLoaded:sumReady.has(key)&&(!uid||!accountInvalid&&(Boolean(owned)||voteReady.has(key))),createdAt:owned?.created?.toDate()??null,createdVersion:owned?.created?version(owned.created):null});
    }
    const rows=sortedCodeEvidence(records);
    onChange({records:rows,publicLoading:publicReady.size!==2,ownLoading:Boolean(uid&&ownReady.size!==2),feedbackLoading:rows.some(row=>row.visibility === "public"&&(!row.feedbackLoaded||row.ownership === "unknown")),publicError:[...publicErrors.values()][0]??null,ownError:[...ownErrors.values()][0]??null,feedbackError});
  }
  function restart(){
    detailGeneration++;const generation=detailGeneration;detailStops.splice(0).forEach(stop=>stop());sums.clear();votes.clear();ownership.clear();sumReady.clear();voteReady.clear();ownerReady.clear();feedbackError=null;
    for(const row of [...publicRows.values()].flat()){
      const key=rowID(row);
      function watch(ref:DocumentReference,decode:(data:DocumentData)=>Feedback|Vote|RecordData,target:Map<string,Feedback|null>|Map<string,Vote|null>|Map<string,RecordData|null>,ready:Set<string>){
        detailStops.push(onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
          if(!active||generation!==detailGeneration||snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
          try{if(scope)check(scope);const value=snapshot.exists()?decode(snapshot.data()):null;(target as Map<string,Feedback|Vote|RecordData|null>).set(key,value);ready.add(key);}
          catch{target.delete(key);ready.delete(key);feedbackError="Some code checks could not be confirmed. Earlier reports remain visible.";}
          emit();
        },()=>{if(!active||generation!==detailGeneration)return;target.delete(key);ready.delete(key);feedbackError="Code checks could not load. Earlier reports remain visible.";emit();}));
      }
      watch(feedbackRef(db,row),data=>summary(row,data),sums,sumReady);
      if(scope){
        watch(voteRef(db,scope.uid,row),data=>ownVote(row,data),votes,voteReady);
        if(row.kind === "v2")watch(ownRef(db,scope.uid,"v2",placeID,row.reportID),data=>{const own=ownRecord("v2",placeID,row.reportID,data);if(!same(own,row))fail();return own;},ownership,ownerReady);
      }
    }
    emit();
  }
  try{
    place(placeID);client=requireClient();scope=uid?account(uid):null;db=getFirestore(client.app);
    if(scope)stops.push(onAuthStateChanged(client.auth,user=>{if(!active||user===scope!.user)return;accountInvalid=true;ownRows.clear();ownership.clear();votes.clear();ownErrors.set("v2","Your account changed. Refresh before loading private codes.");emit();}));
    for(const kind of ["legacy","v2"] as const){
      const feed=query(collection(db,kind === "legacy"?"restroomPasscodeReports":"restroomPasscodeReportsV2",placeID,"reports"),orderBy("codeUpdatedAt","desc"),limit(LIMIT));
      stops.push(onSnapshot(feed,{includeMetadataChanges:true},snapshot=>{
        if(!active||snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
        try{publicRows.set(kind,snapshot.docs.map(item=>publicRecord(kind,placeID,item.id,item.data())));publicErrors.delete(kind);}
        catch{publicRows.set(kind,[]);publicErrors.set(kind,"Some shared codes have invalid details and are hidden.");}
        publicReady.add(kind);restart();
      },()=>{if(!active)return;publicRows.set(kind,[]);publicReady.add(kind);publicErrors.set(kind,"Some shared codes could not load. Retry before using them.");restart();}));
      if(scope){
        const ownedFeed=kind === "legacy"?ownRef(db,uid!,kind,placeID,""):query(collection(db,"users",uid!,"restroomReadyPasscodesV2"),where("placeID","==",placeID),orderBy("createdAt","desc"),limit(LIMIT));
        stops.push(onSnapshot(ownedFeed as DocumentReference,{includeMetadataChanges:true},snapshot=>{
          if(!active||snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
          try{check(scope!);const rows="docs"in snapshot?(snapshot as unknown as {docs:DocumentSnapshot[]}).docs:[snapshot];ownRows.set(kind,rows.filter(item=>item.exists()).map(item=>ownRecord(kind,placeID,item.id,item.data()!)));ownErrors.delete(kind);}
          catch{ownRows.set(kind,[]);ownErrors.set(kind,"Your code reports could not be confirmed. Refresh before changing them.");}
          ownReady.add(kind);restart();
        },()=>{if(!active)return;ownRows.set(kind,[]);ownReady.add(kind);ownErrors.set(kind,"Your code reports could not load. They have not been changed.");restart();}));
      }
    }
    emit();
  }catch(error){queueMicrotask(()=>{if(active)onChange({records:[],publicLoading:false,ownLoading:false,feedbackLoading:false,publicError:readable(error).message,ownError:null,feedbackError:null});});}
  return()=>{active=false;detailGeneration++;stops.forEach(stop=>stop());detailStops.forEach(stop=>stop());};
}
