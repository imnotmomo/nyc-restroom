import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, symlink, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { prepareRelease, SOURCES } from './package.mjs';
import { verifyPackage, RELEASE_FILES } from './verify-package.mjs';
import { withModerationImport } from './configure-caddy.mjs';
import { validateConfiguration } from './preflight.mjs';
import { assertServiceIdentity } from './service-identity.mjs';
const repo=resolve(import.meta.dirname,'../..');
const tar=(source,path)=>execFileSync('tar',['--format=ustar','--no-xattrs','-czf',path,'-C',source,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
async function fixture(action){const root=await mkdtemp(join(tmpdir(),'rr-moderation-deploy-test-'));try{return await action(root);}finally{await rm(root,{recursive:true,force:true});}}

test('package contains exactly reviewed runtime files and hashes, excluding demo/tests/private state',async()=>fixture(async root=>{
 assert.deepEqual([...SOURCES.values()].sort(),[...RELEASE_FILES].sort());
 const stage=join(root,'release'),archive=join(root,'release.tar.gz'),release=await prepareRelease(repo,stage);tar(stage,archive);const verified=await verifyPackage(archive);assert.equal(verified.release,release);assert.match(verified.sha256,/^[a-f0-9]{64}$/);assert.equal(Object.keys(verified.files).length,17);
 for(const path of Object.keys(verified.files)){assert.equal(/(^|\/)(test|tests|dev\.mjs|node_modules|admin\.json|runtime\.env|moderators\.json|\.firebase-agent)(\/|$)/.test(path),false);}
}));
for(const issue of ['changed-source','extra-secret-file','symlink','broken-gzip'])test(`package validation refuses ${issue} before extraction`,async()=>fixture(async root=>{
 const stage=join(root,'release'),archive=join(root,'release.tar.gz');await prepareRelease(repo,stage);
 if(issue==='changed-source')await writeFile(join(stage,'src/service.mjs'),'changed');
 if(issue==='extra-secret-file')await writeFile(join(stage,'admin.json'),'not-a-credential');
 if(issue==='symlink'){await rm(join(stage,'src/service.mjs'));await symlink('/etc/passwd',join(stage,'src/service.mjs'));}
 tar(stage,archive);if(issue==='broken-gzip')await writeFile(archive,'invalid');await assert.rejects(verifyPackage(archive));
}));
test('source allowlist refuses a symlink rather than following it into a package',async()=>fixture(async root=>{
 const fake=join(root,'fake');await mkdir(join(fake,'backend/moderation'),{recursive:true});await writeFile(join(root,'private'),'fixture');await symlink(join(root,'private'),join(fake,'backend/moderation/package.json'));await assert.rejects(prepareRelease(fake,join(root,'release')),/Unsupported release input/);
}));
test('Caddy insertion preserves legacy directives and accepts the canonical existing import idempotently',async()=>{
 const canonical=await readFile(join(repo,'deploy/vps/Caddyfile'),'utf8');
 const block=/\t# BEGIN Restroom Ready moderation\n\timport \/etc\/caddy\/restroom-ready-moderation\.caddy\n\t# END Restroom Ready moderation\n/;
 const legacy=canonical.replace(block,'');const candidate=withModerationImport(legacy);
 assert.equal(withModerationImport(candidate),candidate);assert.equal(candidate.replace(block,''),legacy);assert.equal(withModerationImport(canonical),candidate);
 assert.ok(candidate.includes('@accountDeletion path /api/account/delete'));assert.ok(candidate.includes('reverse_proxy 127.0.0.1:3000'));
 for(const source of ['another.example {\n}\n',legacy+legacy,legacy.replace('encode zstd gzip','import /etc/caddy/restroom-ready-moderation.caddy'),candidate.replace('# END Restroom Ready moderation','# END broken')])assert.throws(()=>withModerationImport(source));
});
test('private preflight pins the dedicated project/principal, strict env, private modes and nonsymlink files',async()=>fixture(async root=>{
 const credential=join(root,'admin.json'),env=join(root,'runtime.env'),roster='/var/lib/restroom-ready-moderation/moderators.json';
 const valid={type:'service_account',project_id:'nye-restroom',client_email:'restroom-moderation@nye-restroom.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----fixture'};
 const validEnv=`MODERATOR_ROSTER_PATH=${roster}\nMODERATOR_BOOTSTRAP_EMAIL=moderator@example.test\n`;
 await writeFile(credential,JSON.stringify(valid),{mode:0o600});await writeFile(env,validEnv,{mode:0o600});await validateConfiguration(credential,env,roster);
 for(const patch of [{project_id:'other-project'},{client_email:'restroom-account-deletion@nye-restroom.iam.gserviceaccount.com'},{type:'authorized_user'}]){await writeFile(credential,JSON.stringify({...valid,...patch}));await assert.rejects(validateConfiguration(credential,env,roster));}
 await writeFile(credential,JSON.stringify(valid));await chmod(credential,0o644);await assert.rejects(validateConfiguration(credential,env,roster));await chmod(credential,0o600);
 for(const extra of ['FIRESTORE_EMULATOR_HOST=127.0.0.1:8185\n','GOOGLE_APPLICATION_CREDENTIALS=/other/key\n','MODERATOR_BOOTSTRAP_EMAIL=other@example.test\n']){await writeFile(env,validEnv+extra);await assert.rejects(validateConfiguration(credential,env,roster));}
 await writeFile(env,validEnv);const link=join(root,'key-link');await symlink(credential,link);await assert.rejects(validateConfiguration(link,env,roster));
}));
test('proposed IAM permissions are the exact runtime-only seven, without Auth mutation or index/IAM administration',async()=>{
 const role=JSON.parse(await readFile(join(repo,'deploy/moderation/iam-role.json'),'utf8'));assert.deepEqual(role.includedPermissions.sort(),['datastore.databases.get','datastore.entities.get','datastore.entities.list','datastore.entities.create','datastore.entities.update','datastore.entities.delete','firebaseauth.users.get'].sort());
});

test('service acceptance binds health to the active systemd PID, exact release and single loopback listener',()=>{
 const expected={release:'/srv/restroom-ready-moderation/releases/fixture',node:'/opt/node/bin/node',entry:'/srv/restroom-ready-moderation/releases/fixture/src/server.mjs'};
 const valid={active:'active',pid:123,cwd:expected.release,exe:expected.node,entry:expected.entry,listeners:'LISTEN 0 511 127.0.0.1:3003 0.0.0.0:* users:(("node",pid=123,fd=22))'};
 assert.doesNotThrow(()=>assertServiceIdentity(valid,expected));
 for(const patch of [{active:'activating'},{active:'failed'},{pid:0},{cwd:'/srv/restroom-ready-moderation/releases/old'},{exe:'/usr/bin/unrelated'},{entry:'/srv/restroom-ready-moderation/releases/fixture/src/other.mjs'},{listeners:valid.listeners.replace('pid=123','pid=999')},{listeners:valid.listeners.replace('127.0.0.1:3003','0.0.0.0:3003')},{listeners:valid.listeners+'\n'+valid.listeners},{listeners:''}])assert.throws(()=>assertServiceIdentity({...valid,...patch},expected));
});


test('privileged workspace framing/referrer/cache headers are scoped to admin documents only',async()=>{
 const snippet=await readFile(join(repo,'deploy/moderation/Caddyfile.snippet'),'utf8');
 assert.match(snippet,/@restroomModeratorWorkspace path \/admin \/admin\/\*\n/);
 const block=/header @restroomModeratorWorkspace \{\n([^}]+)\}/.exec(snippet)?.[1];assert.ok(block);
 assert.match(block,/^\t>Content-Security-Policy "frame-ancestors 'none'"$/m);assert.match(block,/^\t>X-Frame-Options DENY$/m);assert.match(block,/^\t>Referrer-Policy no-referrer$/m);assert.match(block,/^\t>Cache-Control no-store$/m);
 assert.equal(snippet.match(/Content-Security-Policy/g)?.length,1);assert.equal(snippet.match(/X-Frame-Options/g)?.length,1);
 assert.match(snippet,/@restroomModerationAPI path \/api\/moderation\/\*/);assert.match(snippet,/reverse_proxy 127\.0\.0\.1:3003/);
});
