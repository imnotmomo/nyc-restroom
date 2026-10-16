# VPS deployment

The team owns `206.189.203.190`; `nyc.imfinethanku.me` points to it. The server runs Ubuntu 24.04, Node.js 24.22.0 LTS, and Caddy from its official package repository. SSH uses the existing administrator key. Firebase Authentication and Firestore remain in `nye-restroom`.

## Runtime

- Caddy handles HTTP-to-HTTPS redirects and certificate renewal, forwarding to `127.0.0.1:3000`.
- `restroom-ready.service` runs as the unprivileged `restroom-ready` user and starts on boot. Its application and Node binary are read-only to that user.
- Application releases live in `/srv/restroom-ready/releases/`; `/srv/restroom-ready/current` selects the active release.
- Signup SQLite lives at `/var/lib/restroom-ready/waitlist.sqlite`, owned by the service user. It survives releases and restarts.
- `/etc/restroom-ready/runtime.env` sets `PORT`, `WAITLIST_DB_PATH`, and `PUBLIC_ORIGIN=https://nyc.imfinethanku.me`. The origin is validated before opening the database. Signup origin checks remain enabled behind the HTTPS proxy; arbitrary forwarded headers are not trusted.
- GET/HEAD `/api/health` provides uncached process liveness. It does not certify external Firebase availability or an ongoing database write.

The server needs no npm dependencies or Firebase CLI login. The runtime archive includes only the built public assets, Node entry points, shared signup validation, SQL schema, deployment templates, and a release record. Local login sessions, private environment files, signup databases, source research, and `node_modules` are excluded.

## Build and deploy an update

Use Node.js 24 locally. After installing dependencies, run:

```sh
npm test
npm run typecheck
npm run build
bash deploy/vps/deploy.sh
```

The deployment script uses the existing root SSH access, verifies the uploaded archive's SHA-256, installs a new root-owned release, switches the active symlink, and checks local process health. If startup fails, it restores the previous release when one exists. It backs up Caddy's configuration before replacing it. Dependencies and the service account must already be provisioned.

Google Sign-in authorizes the new hostname in `firebase.json`. The Firebase SDK's `authDomain` remains `nye-restroom.firebaseapp.com`; do not replace it with the VPS hostname.

MapKit is a browser dependency. Put the domain-restricted web token in ignored `.env.local` as `NEXT_PUBLIC_MAPKIT_JS_TOKEN`, then rebuild and deploy. Changing the systemd environment alone cannot change an exported frontend. Until the team supplies a valid token, the app uses its existing OpenStreetMap fallback. The Apple token must allow `nyc.imfinethanku.me`. Never put an Apple signing private key on the server or in the browser bundle.

## Operations and rollback

```sh
ssh root@206.189.203.190 'systemctl status restroom-ready caddy --no-pager'
ssh root@206.189.203.190 'journalctl -u restroom-ready -n 50 --no-pager'
curl -fsS https://nyc.imfinethanku.me/api/health
```

To roll back, select a retained release under `/srv/restroom-ready/releases/`, repoint `current` using a temporary symlink and atomic rename, then restart only `restroom-ready.service`. Do not replace or delete `/var/lib/restroom-ready` during a rollback. Stop the app before copying its SQLite file for a consistent backup, or use SQLite's backup API. Keep backups private and outside Git.

The original Sites deployment remains available. Its D1 waitlist and this server's SQLite waitlist are separate stores; existing D1 signups have not been migrated or deleted. Saved places and private notes continue using the same Firebase database across both hosts.

## Verification

The HTTPS-origin regression, foreign-origin rejection, local-preview behavior, invalid configuration, and health endpoint are covered by server runtime tests. Sixteen fast tests and TypeScript checking passed before deployment. Deployment evidence and remaining browser limitations are recorded in `docs/features/vps-hosting.md`.
