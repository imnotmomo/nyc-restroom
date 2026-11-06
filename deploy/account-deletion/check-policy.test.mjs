import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkPolicy } from './check-policy.mjs';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'rr-policy-floor-'));
  const release = join(directory, 'RELEASE.json'), floor = join(directory, 'floor');
  try { await run({directory,release,floor}); }
  finally { await rm(directory,{recursive:true,force:true}); }
}

for (const [version,floorVersion,allowed] of [[2,2,true],[3,2,true],[3,3,true],[4,3,true],[4,4,true],[3,4,false],[2,4,false],[1,4,false],[1,2,false],[1,3,false],[2,3,false],[0,1,false]]) {
  test(`release ${version} / floor ${floorVersion} is ${allowed ? 'allowed' : 'blocked'}`, () => fixture(async ({release,floor}) => {
    await writeFile(release,JSON.stringify({policyVersion:version}));
    await writeFile(floor,String(floorVersion));
    if(allowed) assert.equal(await checkPolicy(release,floor),version);
    else await assert.rejects(checkPolicy(release,floor));
  }));
}

test('legacy metadata is allowed only before the preserving-policy floor', () => fixture(async ({release,floor}) => {
  await writeFile(release,JSON.stringify({release:'legacy'}));
  assert.equal(await checkPolicy(release,floor),1);
  await writeFile(floor,'2');
  await assert.rejects(checkPolicy(release,floor));
}));

test('invalid or empty floors fail closed', () => fixture(async ({release,floor}) => {
  await writeFile(release,JSON.stringify({policyVersion:2}));
  for(const value of ['','0','-1','NaN','2.5']) {
    await writeFile(floor,value); await assert.rejects(checkPolicy(release,floor));
  }
}));

test('a managed current symlink still reads the real release version', () => fixture(async ({directory,floor}) => {
  const target=join(directory,'releases','v2'); await mkdir(target,{recursive:true});
  await writeFile(join(target,'RELEASE.json'),JSON.stringify({policyVersion:2}));
  await symlink(target,join(directory,'current')); await writeFile(floor,'2');
  assert.equal(await checkPolicy(join(directory,'current','RELEASE.json'),floor),2);
}));

test('the actual startup command blocks an older release without leaking its contents', () => fixture(async ({release,floor}) => {
  await writeFile(release,JSON.stringify({policyVersion:1,privateFixture:'never-log-this-value'}));
  await writeFile(floor,'2');
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./check-policy.mjs',import.meta.url)),release,floor],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr,'Account service policy preflight failed.\n');
}));
