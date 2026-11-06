#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_dir=$(cd "$(dirname "$0")/../.." && pwd)
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/restroom-account-maintenance.XXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
node --input-type=module - "$repo_dir/deploy/vps/Caddyfile" "$staging_dir/Caddyfile" <<'NODE'
import {readFile,writeFile} from 'node:fs/promises';
const [source,target]=process.argv.slice(2);
const text=await readFile(source,'utf8');
const before='\thandle @accountDeletion {';
const start=text.indexOf(before),end=text.indexOf('\n\thandle {',start);
if(start<0||end<0)throw Error('Account route not found');
const block='\thandle @accountDeletion {\n\t\theader Content-Type application/json\n\t\theader Retry-After 60\n\t\trespond "{\\"error\\":\\"deletion_unavailable\\"}" 503\n\t}';
await writeFile(target,text.slice(0,start)+block+text.slice(end));
NODE
canonical_sha=$(shasum -a 256 "$repo_dir/deploy/vps/Caddyfile" | awk '{print $1}')
maintenance_sha=$(shasum -a 256 "$staging_dir/Caddyfile" | awk '{print $1}')
scp -q -o BatchMode=yes "$staging_dir/Caddyfile" root@206.189.203.190:/tmp/restroom-account-maintenance.caddy
ssh -o BatchMode=yes root@206.189.203.190 bash -s -- "$canonical_sha" "$maintenance_sha" <<'REMOTE'
set -euo pipefail
umask 077
exec 9>/var/lock/restroom-ready-account-deploy.lock
flock -n 9
canonical_sha=$1
maintenance_sha=$2
incoming=/tmp/restroom-account-maintenance.caddy
trap 'rm -f "$incoming"' EXIT
printf '%s  %s\n' "$maintenance_sha" "$incoming" | sha256sum -c -
current_sha=$(sha256sum /etc/caddy/Caddyfile | awk '{print $1}')
if [ "$current_sha" != "$canonical_sha" ] && [ "$current_sha" != "$maintenance_sha" ]; then
  echo 'Current proxy changed; refusing to overwrite it.' >&2
  exit 1
fi
caddy validate --config "$incoming" --adapter caddyfile
backup="/etc/caddy/Caddyfile.before-account-anonymization-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p /etc/caddy/Caddyfile "$backup"
install -m 644 "$incoming" /etc/caddy/Caddyfile
if ! systemctl reload caddy || [ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' https://nyc.imfinethanku.me/api/account/delete)" != 503 ]; then
  cp -p "$backup" /etc/caddy/Caddyfile
  systemctl reload caddy
  exit 1
fi
# Block new HTTP requests before draining the old policy worker.
systemctl stop restroom-ready-account
if systemctl is-active --quiet restroom-ready-account; then exit 1; fi
test -z "$(ss -H -ltn sport = :3002)"
install -m 600 /dev/null /etc/restroom-ready-account/maintenance
curl -fsS https://nyc.imfinethanku.me/api/health >/dev/null
printf 'Account deletion is in maintenance; the main website remains healthy.\n'
REMOTE
