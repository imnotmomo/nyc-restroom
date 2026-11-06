#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_dir=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo_dir"
test -f backend/account-deletion/package-lock.json
test -f backend/account-deletion/src/server.mjs
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/restroom-account-release.XXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
mkdir -p "$staging_dir/release"
cp backend/account-deletion/package.json backend/account-deletion/package-lock.json "$staging_dir/release/"
cp -R backend/account-deletion/src "$staging_dir/release/src"
cp deploy/account-deletion/restroom-ready-account.service deploy/account-deletion/check-policy.mjs deploy/account-deletion/policy-floor.conf deploy/vps/Caddyfile "$staging_dir/release/"
node --input-type=module - "$staging_dir/release" "$release_id" <<'NODE'
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [rootArg,release]=process.argv.slice(2),root=resolve(rootArg),files={};
const {DELETION_POLICY_VERSION:policyVersion}=await import(pathToFileURL(join(root,'src/policy.mjs')));
if(!Number.isSafeInteger(policyVersion)||policyVersion<2)throw Error('A preserving account policy is required');
async function walk(dir){for(const ent of await readdir(dir,{withFileTypes:true})){const name=join(dir,ent.name);if(ent.isDirectory())await walk(name);else if(ent.isFile())files[name.slice(root.length+1)]=createHash('sha256').update(await readFile(name)).digest('hex');else throw Error('Release contains an unsupported file type');}}
await walk(root);await writeFile(join(root,'RELEASE.json'),JSON.stringify({release,policyVersion,files},null,2)+'\n');
NODE
archive_path="$staging_dir/$release_id.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive_path" -C "$staging_dir/release" .
archive_sha=$(shasum -a 256 "$archive_path" | awk '{print $1}')
remote=root@206.189.203.190
scp -q -o BatchMode=yes "$archive_path" "$remote:/tmp/restroom-account-$release_id.tar.gz"
ssh -o BatchMode=yes "$remote" bash -s -- "$release_id" "$archive_sha" <<'REMOTE'
set -euo pipefail
umask 077
exec 9>/var/lock/restroom-ready-account-deploy.lock
flock -n 9
release_id=$1
archive_sha=$2
case "$release_id" in *[!A-Za-z0-9-]*) exit 1;; esac
case "$archive_sha" in *[!a-f0-9]*) exit 1;; esac
credential=/etc/restroom-ready-account/admin.json
test -f "$credential"
/opt/node/bin/node --input-type=module - "$credential" <<'NODE'
import {readFile} from 'node:fs/promises';
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
if(c.type!=='service_account'||c.project_id!=='nye-restroom'||c.client_email!=='restroom-account-deletion@nye-restroom.iam.gserviceaccount.com'||typeof c.private_key!=='string'||!c.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))throw Error('Wrong account service credential');
NODE
archive_path="/tmp/restroom-account-$release_id.tar.gz"
release_dir="/srv/restroom-ready-account/releases/$release_id"
test ! -e "$release_dir"
printf '%s  %s\n' "$archive_sha" "$archive_path" | sha256sum -c -
getent passwd restroom-ready-account >/dev/null || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin restroom-ready-account
chown root:restroom-ready-account /etc/restroom-ready-account
chmod 750 /etc/restroom-ready-account
chown root:restroom-ready-account "$credential"
chmod 640 "$credential"
install -d -m 755 "$release_dir"
tar --no-same-owner -xzf "$archive_path" -C "$release_dir"
/opt/node/bin/node --input-type=module - "$release_dir" <<'NODE'
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],m=JSON.parse(await readFile(join(root,'RELEASE.json'),'utf8'));
for(const [path,sha]of Object.entries(m.files)){if(resolve(root,path)!==join(root,path)||!resolve(root,path).startsWith(root+'/'))throw Error('Invalid release path');if(createHash('sha256').update(await readFile(join(root,path))).digest('hex')!==sha)throw Error('Release hash mismatch');}
NODE
PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /opt/node/bin/npm ci --prefix "$release_dir" --ignore-scripts --omit=dev --no-audit --no-fund >/dev/null
chown -R root:root "$release_dir"
chmod -R u=rwX,go=rX "$release_dir"
caddy validate --config "$release_dir/Caddyfile" --adapter caddyfile
previous_release=''
if [ -L /srv/restroom-ready-account/current ]; then
  previous_release=$(readlink -e /srv/restroom-ready-account/current)
  case "$previous_release" in /srv/restroom-ready-account/releases/*) ;; *) exit 1;; esac
elif [ -e /srv/restroom-ready-account/current ]; then
  echo 'Account current path is not a managed symlink.' >&2
  exit 1
fi
candidate_policy=$(/opt/node/bin/node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).policyVersion" "$release_dir/RELEASE.json")
floor_file=/etc/restroom-ready-account/minimum-policy-version
policy_floor=1
if [ -f "$floor_file" ]; then policy_floor=$(cat "$floor_file"); fi
previous_policy=0
if [ -n "$previous_release" ]; then
  previous_policy=$(/opt/node/bin/node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).policyVersion ?? 1" "$previous_release/RELEASE.json")
fi
case "$candidate_policy:$policy_floor:$previous_policy" in *[!0-9:]*) exit 1;; esac
test "$candidate_policy" -ge 2
test "$candidate_policy" -ge "$policy_floor"
if [ "$previous_policy" -lt "$candidate_policy" ]; then
  test -f /etc/restroom-ready-account/maintenance
  test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' https://nyc.imfinethanku.me/api/account/delete)" = 503
fi
# A persistent drop-in also blocks an accidental manual restart of an older release.
install -d -m 755 /usr/local/libexec /etc/systemd/system/restroom-ready-account.service.d
install -m 644 "$release_dir/check-policy.mjs" /usr/local/libexec/restroom-ready-account-policy-check.mjs
install -m 644 "$release_dir/policy-floor.conf" /etc/systemd/system/restroom-ready-account.service.d/policy-floor.conf
unit=/etc/systemd/system/restroom-ready-account.service
unit_backup="$unit.before-$release_id"
if [ -f "$unit" ]; then cp -p "$unit" "$unit_backup"; fi
previously_enabled=false
if systemctl is-enabled --quiet restroom-ready-account; then previously_enabled=true; fi
cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-account-$release_id"
rollback() {
  policy_floor=$(cat "$floor_file" 2>/dev/null || printf 1)
  compatible_previous=false
  if [ -n "$previous_release" ] && [ "$previous_policy" -ge "$policy_floor" ]; then compatible_previous=true; fi
  systemctl stop restroom-ready-account || true
  if [ -f "$unit_backup" ]; then cp -p "$unit_backup" "$unit"; fi
  if [ ! -f "$unit_backup" ]; then rm -f "$unit"; fi
  systemctl daemon-reload
  if [ "$compatible_previous" = true ]; then
    ln -s "$previous_release" /srv/restroom-ready-account/current.rollback
    mv -Tf /srv/restroom-ready-account/current.rollback /srv/restroom-ready-account/current
    systemctl restart restroom-ready-account || true
  else
    if [ -z "$previous_release" ] && [ -L /srv/restroom-ready-account/current ] && [ "$(readlink -e /srv/restroom-ready-account/current)" = "$release_dir" ]; then
      rm -f /srv/restroom-ready-account/current
    fi
    echo 'No compatible account-policy rollback; deletion remains unavailable until repaired.' >&2
  fi
  if [ "$previously_enabled" != true ]; then systemctl disable restroom-ready-account >/dev/null 2>&1 || true; fi
  cp -p "/etc/caddy/Caddyfile.before-account-$release_id" /etc/caddy/Caddyfile
  systemctl reload caddy || true
}
deployment_exit() {
  result=$1
  trap - EXIT
  if [ "$result" -ne 0 ]; then rollback || true; fi
  rm -f "$archive_path"
  exit "$result"
}
trap 'deployment_exit $?' EXIT
if [ "$candidate_policy" -gt "$policy_floor" ]; then
  printf '%s\n' "$candidate_policy" > "$floor_file.next"
  chmod 644 "$floor_file.next"
  mv -f "$floor_file.next" "$floor_file"
fi
install -m 644 "$release_dir/restroom-ready-account.service" "$unit"
systemctl daemon-reload
ln -s "$release_dir" /srv/restroom-ready-account/current.next
mv -Tf /srv/restroom-ready-account/current.next /srv/restroom-ready-account/current
healthy=false
if systemctl restart restroom-ready-account; then
  for attempt in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:3002/health >/dev/null; then healthy=true; break; fi
    sleep 1
  done
fi
if [ "$healthy" != true ]; then echo 'Account service failed health; rolling back.' >&2; exit 1; fi
install -m 644 "$release_dir/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy
systemctl enable restroom-ready-account >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' https://nyc.imfinethanku.me/api/account/delete)" = 401
curl -fsS https://nyc.imfinethanku.me/api/health >/dev/null
rm -f /etc/restroom-ready-account/maintenance
printf 'Deployed account service %s\n' "$release_id"
REMOTE
