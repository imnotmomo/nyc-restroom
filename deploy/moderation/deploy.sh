#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_dir=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo_dir"
usage() {
  echo 'Usage: deploy/moderation/deploy.sh --package-only /absolute/new-release.tar.gz' >&2
  echo '       deploy/moderation/deploy.sh --deploy /absolute/reviewed-release.tar.gz' >&2
  exit 2
}
test "$#" -eq 2 || usage
mode=$1
archive_path=$2
case "$archive_path" in /*) ;; *) usage;; esac
case "$mode" in
  --package-only)
    test ! -e "$archive_path"
    staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/restroom-moderation-package.XXXXXX")
    trap 'rm -rf "$staging_dir"' EXIT
    node deploy/moderation/package.mjs "$repo_dir" "$staging_dir/release" >/dev/null
    COPYFILE_DISABLE=1 tar --format=ustar --no-xattrs -czf "$archive_path" -C "$staging_dir/release" .
    node deploy/moderation/verify-package.mjs "$archive_path"
    exit 0
    ;;
  --deploy) ;;
  *) usage;;
esac
# This explicit mode changes only the separate VPS service and its scoped Caddy import.
# Credential/IAM provisioning, Firebase deployment, and static-page deployment are separate.
validated=$(node deploy/moderation/verify-package.mjs "$archive_path")
release_id=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).release)' "$validated")
archive_sha=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$validated")
remote=root@206.189.203.190
# A root-only random upload directory prevents predictable /tmp symlink replacement.
incoming=$(ssh -o BatchMode=yes "$remote" 'umask 077; mktemp -d /tmp/restroom-moderation.XXXXXXXX')
case "$incoming" in /tmp/restroom-moderation.????????) ;; *) exit 1;; esac
case "$incoming" in *[!A-Za-z0-9/.-]*) exit 1;; esac
cleanup_upload() {
  ssh -o BatchMode=yes "$remote" bash -s -- "$incoming" <<'CLEANUP' || true
set -euo pipefail
incoming=$1
case "$incoming" in /tmp/restroom-moderation.????????) ;; *) exit 1;; esac
case "$incoming" in *[!A-Za-z0-9/.-]*) exit 1;; esac
if [ -d "$incoming" ] && [ ! -L "$incoming" ]; then
  rm -f "$incoming/package.tar.gz" "$incoming/verify.mjs"
  rmdir "$incoming" || true
fi
CLEANUP
}
trap cleanup_upload EXIT
scp -q -o BatchMode=yes "$archive_path" "$remote:$incoming/package.tar.gz"
# Use the repository's already-reviewed validator before extracting any transferred archive.
scp -q -o BatchMode=yes deploy/moderation/verify-package.mjs "$remote:$incoming/verify.mjs"
ssh -o BatchMode=yes "$remote" bash -s -- "$incoming" "$release_id" "$archive_sha" <<'REMOTE'
set -euo pipefail
umask 077
incoming=$1
release_id=$2
archive_sha=$3
case "$incoming" in /tmp/restroom-moderation.????????) ;; *) exit 1;; esac
case "$incoming" in *[!A-Za-z0-9/.-]*) exit 1;; esac
test -d "$incoming" && test ! -L "$incoming"
test "$(stat -c %u "$incoming")" = 0
test "$(stat -c %a "$incoming")" = 700
case "$release_id" in *[!A-Za-z0-9-]*) exit 1;; esac
case "$archive_sha" in *[!a-f0-9]*) exit 1;; esac
test "${#archive_sha}" -eq 64
archive="$incoming/package.tar.gz"
validator="$incoming/verify.mjs"
exec 9>/var/lock/restroom-ready-moderation-deploy.lock
flock -n 9
trap 'rm -f "$archive" "$validator"; rmdir "$incoming" || true' EXIT
printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c - >/dev/null
validated=$(/opt/node/bin/node "$validator" "$archive")
test "$(/opt/node/bin/node -e 'process.stdout.write(JSON.parse(process.argv[1]).release)' "$validated")" = "$release_id"
config=/etc/restroom-ready-moderation
credential="$config/admin.json"
env_file="$config/runtime.env"
state=/var/lib/restroom-ready-moderation
roster="$state/moderators.json"
# Both private files must be provisioned separately; never copy a local secret or create a key.
command -v ss >/dev/null
test -d "$config" && test ! -L "$config"
test -f "$credential" && test ! -L "$credential"
test -f "$env_file" && test ! -L "$env_file"
test -f /etc/caddy/Caddyfile && test ! -L /etc/caddy/Caddyfile
test ! -L "$state"
getent passwd restroom-ready-moderation >/dev/null || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin restroom-ready-moderation
chown root:restroom-ready-moderation "$config"
chmod 750 "$config"
chown root:restroom-ready-moderation "$credential" "$env_file"
chmod 640 "$credential" "$env_file"
install -d -m 700 -o restroom-ready-moderation -g restroom-ready-moderation "$state"
release_dir="/srv/restroom-ready-moderation/releases/$release_id"
test ! -e "$release_dir"
install -d -m 755 "$release_dir"
tar --no-same-owner -xzf "$archive" -C "$release_dir"
/opt/node/bin/node "$release_dir/preflight.mjs" "$credential" "$env_file" "$roster"
# Existing roster ownership/content is never replaced, cleared, or silently reenrolled.
if [ -e "$roster" ]; then
  test "$(stat -c %U "$roster")" = restroom-ready-moderation
  test "$(stat -c %a "$roster")" = 600
fi
PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /opt/node/bin/npm ci --prefix "$release_dir" --ignore-scripts --omit=dev --no-audit --no-fund >/dev/null
chown -R root:root "$release_dir"
chmod -R u=rwX,go=rX "$release_dir"
runuser -u restroom-ready-moderation -- /opt/node/bin/node "$release_dir/preflight.mjs" "$credential" "$env_file" "$roster"
unit=/etc/systemd/system/restroom-ready-moderation.service
snippet=/etc/caddy/restroom-ready-moderation.caddy
backup_dir="/srv/restroom-ready-moderation/deploy-backups/$release_id"
candidate="/etc/caddy/Caddyfile.moderation-$release_id.next"
test ! -e "$candidate"
install -d -m 700 "$backup_dir"
cp -p /etc/caddy/Caddyfile "$backup_dir/Caddyfile"
if [ -e "$snippet" ]; then test -f "$snippet" && test ! -L "$snippet"; cp -p "$snippet" "$backup_dir/snippet"; fi
if [ -e "$unit" ]; then test -f "$unit" && test ! -L "$unit"; cp -p "$unit" "$backup_dir/unit"; fi
current=/srv/restroom-ready-moderation/current
previous=''
if [ -L "$current" ]; then
  previous=$(readlink -e "$current")
  case "$previous" in /srv/restroom-ready-moderation/releases/*) ;; *) exit 1;; esac
elif [ -e "$current" ]; then echo 'Current moderation path is not a managed symlink.' >&2; exit 1; fi
previously_enabled=false
if systemctl is-enabled --quiet restroom-ready-moderation; then previously_enabled=true; fi
rollback() {
  systemctl stop restroom-ready-moderation || true
  cp -p "$backup_dir/Caddyfile" /etc/caddy/Caddyfile
  if [ -f "$backup_dir/snippet" ]; then cp -p "$backup_dir/snippet" "$snippet"; else rm -f "$snippet"; fi
  if [ -f "$backup_dir/unit" ]; then cp -p "$backup_dir/unit" "$unit"; else rm -f "$unit"; fi
  systemctl daemon-reload
  if [ -n "$previous" ]; then
    ln -s "$previous" "$current.rollback-$release_id"
    mv -Tf "$current.rollback-$release_id" "$current"
    systemctl restart restroom-ready-moderation || true
  elif [ -L "$current" ]; then rm -f "$current"; fi
  if [ "$previously_enabled" != true ]; then systemctl disable restroom-ready-moderation >/dev/null 2>&1 || true; fi
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy || true
}
finish() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ]; then rollback || echo 'Rollback needs operator attention.' >&2; fi
  rm -f "$archive" "$validator" "$candidate" "$current.next-$release_id" "$current.rollback-$release_id"
  rmdir "$incoming" || true
  exit "$result"
}
trap finish EXIT
install -m 644 "$release_dir/Caddyfile.snippet" "$snippet"
/opt/node/bin/node "$release_dir/configure-caddy.mjs" /etc/caddy/Caddyfile "$candidate"
caddy validate --config "$candidate" --adapter caddyfile >/dev/null
install -m 644 "$release_dir/restroom-ready-moderation.service" "$unit"
systemctl daemon-reload
ln -s "$release_dir" "$current.next-$release_id"
mv -Tf "$current.next-$release_id" "$current"
systemctl restart restroom-ready-moderation
healthy=false
for attempt in $(seq 1 20); do
  if /opt/node/bin/node "$release_dir/service-identity.mjs" "$release_dir" >/dev/null 2>&1 \
    && curl -fsS --max-time 3 http://127.0.0.1:3003/health >/dev/null; then healthy=true; break; fi
  sleep 1
done
if [ "$healthy" != true ]; then echo 'Moderator service did not become healthy.' >&2; exit 1; fi
test "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/api/moderation/session)" = 401
/opt/node/bin/node "$release_dir/service-identity.mjs" "$release_dir"
install -m 644 "$candidate" /etc/caddy/Caddyfile
systemctl reload caddy
systemctl enable restroom-ready-moderation >/dev/null
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://nyc.imfinethanku.me/api/moderation/session)" = 401
curl -fsS --max-time 10 https://nyc.imfinethanku.me/api/health >/dev/null
/opt/node/bin/node "$release_dir/service-identity.mjs" "$release_dir"
printf 'Deployed moderator API %s; authorized moderator readback is still required.\n' "$release_id"
REMOTE
