#!/usr/bin/env bash
set -euo pipefail

# Build and run checks first. This copies only the public build and its runtime.
repo_dir=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo_dir"
test -f dist/server/index.js
test -f .next/BUILD_ID
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/restroom-ready-release.XXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
source_dirty=false
if [ -n "$(git status --porcelain)" ]; then source_dirty=true; fi
cat > "$staging_dir/RELEASE.txt" <<EOF
release=$release_id
source_head=$(git rev-parse HEAD)
source_dirty=$source_dirty
next_build_id=$(cat .next/BUILD_ID)
EOF
archive_path="$staging_dir/$release_id.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive_path" \
  dist/server/index.js scripts/serve.mjs scripts/local-store.mjs \
  worker/waitlist.mjs drizzle/0000_waitlist.sql \
  deploy/vps/restroom-ready.service deploy/vps/Caddyfile deploy/vps/runtime.env.example \
  -C "$staging_dir" RELEASE.txt
archive_sha=$(shasum -a 256 "$archive_path" | awk '{print $1}')
remote=root@206.189.203.190
scp -q -o BatchMode=yes "$archive_path" "$remote:/tmp/$release_id.tar.gz"
ssh -o BatchMode=yes "$remote" bash -s -- "$release_id" "$archive_sha" <<'REMOTE'
set -euo pipefail
release_id=$1
archive_sha=$2
case "$release_id" in *[!A-Za-z0-9-]*) exit 1;; esac
case "$archive_sha" in *[!a-f0-9]*) exit 1;; esac
archive_path="/tmp/$release_id.tar.gz"
release_dir="/srv/restroom-ready/releases/$release_id"
test ! -e "$release_dir"
printf '%s  %s\n' "$archive_sha" "$archive_path" | sha256sum -c -
install -d -m 755 "$release_dir"
tar --no-same-owner -xzf "$archive_path" -C "$release_dir"
chown -R root:root "$release_dir"
chmod -R u=rwX,go=rX "$release_dir"
caddy validate --config "$release_dir/deploy/vps/Caddyfile" --adapter caddyfile
if [ ! -f /etc/restroom-ready/runtime.env ]; then
  install -m 640 -o root -g restroom-ready "$release_dir/deploy/vps/runtime.env.example" /etc/restroom-ready/runtime.env
fi
previous_release=''
if [ -L /srv/restroom-ready/current ]; then
  previous_release=$(readlink -e /srv/restroom-ready/current)
  case "$previous_release" in /srv/restroom-ready/releases/*) ;; *) exit 1;; esac
  test -d "$previous_release"
elif [ -e /srv/restroom-ready/current ]; then
  echo 'Refusing to replace a current path that is not a managed release symlink.' >&2
  exit 1
fi
unit_path=/etc/systemd/system/restroom-ready.service
unit_backup="$unit_path.before-$release_id"
if [ -f "$unit_path" ]; then cp -p "$unit_path" "$unit_backup"; fi
install -m 644 "$release_dir/deploy/vps/restroom-ready.service" "$unit_path"
rollback_app() {
  if [ -f "$unit_backup" ]; then
    cp -p "$unit_backup" "$unit_path"
  else
    systemctl disable --now restroom-ready >/dev/null 2>&1 || true
    rm -f "$unit_path"
  fi
  systemctl daemon-reload
  if [ -n "$previous_release" ] && [ -d "$previous_release" ]; then
    ln -s "$previous_release" /srv/restroom-ready/current.rollback
    mv -Tf /srv/restroom-ready/current.rollback /srv/restroom-ready/current
    systemctl restart restroom-ready
  else
    systemctl stop restroom-ready >/dev/null 2>&1 || true
  fi
}
systemctl daemon-reload
systemctl enable restroom-ready >/dev/null
ln -s "$release_dir" /srv/restroom-ready/current.next
mv -Tf /srv/restroom-ready/current.next /srv/restroom-ready/current
healthy=false
if systemctl restart restroom-ready; then
  for attempt in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then healthy=true; break; fi
    sleep 1
  done
fi
if [ "$healthy" != true ]; then
  rollback_app
  echo 'App failed its health check; previous release restored when available.' >&2
  exit 1
fi
if [ -f /etc/caddy/Caddyfile ]; then cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-$release_id"; fi
install -m 644 "$release_dir/deploy/vps/Caddyfile" /etc/caddy/Caddyfile
systemctl enable --now caddy >/dev/null
systemctl reload caddy
rm -f "$archive_path"
printf 'Deployed %s\n' "$release_id"
REMOTE
