# Moderator API VPS package

Preparation only until the coordinating release is authorized. This folder deploys the separate moderator API to the existing VPS; it does not register users, create service-account keys, change IAM, deploy Firebase rules/indexes, publish the web build, or upload TestFlight builds.

## Runtime and private configuration

The service listens only on `127.0.0.1:3003`. Caddy routes `/api/moderation/*` to it and keeps the existing web and account-deletion routes. `/health` remains loopback-only. Auth and moderator role checks still run for every API request. The scoped `/admin` and `/admin/*` header block denies framing and sets no-referrer/no-store for workspace documents only. The `>` set-with-defer prefix makes each value replace upstream headers at response-write time, avoiding contradictory duplicate cache/referrer policies; see [Caddy header documentation](https://caddyserver.com/docs/caddyfile/directives/header). The block remains a prepared change until Caddy is separately validated and reloaded during the coordinating release.

- Service user/group: `restroom-ready-moderation`, with no login shell or home directory.
- Immutable code: `/srv/restroom-ready-moderation/releases/<release>/`; `current` selects the active release. Root owns the release; the service can only read it.
- Credential: `/etc/restroom-ready-moderation/admin.json`, root-owned, group `restroom-ready-moderation`, mode `0640`, inside a root-owned `0750` directory. The dedicated principal is `restroom-moderation@nye-restroom.iam.gserviceaccount.com` for exactly `nye-restroom`. The script refuses account-deletion credential reuse.
- Environment: `/etc/restroom-ready-moderation/runtime.env`, with the same ownership/mode. Copy the example separately after reviewing its selected bootstrap email. It contains exactly the two documented variables; no emulator or project override is accepted.
- Roster state: `/var/lib/restroom-ready-moderation/`, service-owned, mode `0700`. The API atomically creates `moderators.json` as `0600` on the selected verified Google account's first sign-in. Deployments preserve this file. The email never reenrolls another UID after the first enrollment; an empty roster revokes all access.

The unit grants write access only to its state directory and private temporary directory, drops Linux capabilities, and keeps releases/configuration read-only. It does not share the account-deletion service's user, key or state. Do not set `MemoryDenyWriteExecute`: Node's V8 JIT needs executable memory.

## Proposed IAM role

`iam-role.json` is a proposal for a dedicated project custom role, not a provisioning command. It contains exactly:

| Permission | Required operation |
| --- | --- |
| `datastore.databases.get` | Begin and roll back Firestore transactions. |
| `datastore.entities.get` | Read request/reservation pairs, locks, action receipts, listings and comments. |
| `datastore.entities.list` | Bounded collection-group queries and receipt lookup. |
| `datastore.entities.create` | Approved projections, markers and action receipts. |
| `datastore.entities.update` | Terminal review metadata and text-only redaction. |
| `datastore.entities.delete` | Remove a text-only comment and its exact ownership receipt. |
| `firebaseauth.users.get` | Current user/provider/disabled-state and revocation reads. |

These map to the current SDK calls and official [Firestore IAM method table](https://firebase.google.com/docs/firestore/security/iam) and [Identity Platform API permission table](https://docs.cloud.google.com/identity-platform/docs/access-control). Token signature verification uses public certificates; `verifyIdToken(token, true)` checks current user revocation data. The runtime does not revoke tokens, delete/update/create Auth users, manage IAM or indexes, or require Service Account Token Creator.

The custom role reduces service-wide privileges; it does not enforce a Firestore document-path allowlist. The Admin SDK bypasses client rules, so the reviewed server authorization, strict namespaces, transaction guards and dedicated credential remain required. Provisioning and a live authenticated permission check are separate release steps.

## Package and review

Run from the repository root:

```sh
bash deploy/moderation/deploy.sh --package-only /tmp/restroom-moderation-reviewed.tar.gz
```

This mode performs no network calls. It copies an explicit 15-file allowlist: production package/lockfile, six backend modules, service/configuration templates and four deployment validators. It excludes demo harnesses, tests, `node_modules`, local environment/credential files, Firebase CLI state, source data and the moderator roster. `RELEASE.json` records exact hashes, source HEAD, dirty state and a source-derived release ID. The bounded archive validator rejects links, traversal, extra files, malformed archives and hash mismatches before extraction.

Review the package hashes against the accepted test receipt. Do not rebuild the archive after review unless the changed hashes are reviewed again.

## Authorized deployment

Provision the dedicated key and private environment on the VPS separately. No key is passed as an argument, packaged, printed or copied from the local repository. After authorization:

```sh
bash deploy/moderation/deploy.sh --deploy /tmp/restroom-moderation-reviewed.tar.gz
```

The explicit deploy mode verifies the archive, serializes moderator deployments, installs dependencies with lifecycle scripts disabled, validates private file metadata under both root and the service user, and preserves the roster. It adds one marked Caddy import while retaining existing directives, validates Caddy, switches the release atomically, and checks loopback health plus unauthenticated `401` responses. Before Caddy activation and final acceptance, systemd must be active and its MainPID must own the single loopback listener, run the expected Node binary and server entry, and have the exact release working directory. A stale unrelated health endpoint cannot satisfy that check. Failure restores the previous service/Caddy configuration when available. Credentials and roster content are never reset during rollback. Backups remain root-only under `deploy-backups/`.

A successful health or unauthenticated check proves routing/liveness only. Verify the selected moderator's authenticated session, bounded pending/comment reads and live database/index readiness before calling the feature ready. Do not create production fixture requests/comments for this check.

The canonical `deploy/vps/Caddyfile` must retain the import before any later web deployment, because the existing web deployer replaces Caddy's configuration. The coordinating change now adds the import to that separate template as well. An older account-deletion deployer also carries a full Caddy template; coordinate those releases similarly.

## Firebase rollout and live-index comparison

The captured `.firebase-agent/moderation/live-before/indexes.json` contains one composite and no field overrides. Its existing `restroomReadyPasscodesV2` collection index is retained in `firebase/firestore.indexes.json` with the exact explicit descending `__name__` suffix and `SPARSE_ALL` density. Four proposed moderation composites and the two group-query field overrides remain; no live index or override is removed. Refresh/compare the live inventory immediately before deploying indexes; never force-delete newly added manual indexes from a stale snapshot.

Deploy the compatible web/native pending-request clients and make required indexes ready before activating the strict queue rules. Older clients continue browsing, but their direct Add restroom writes intentionally fail after cutover. The backend package alone does not close that legacy bypass.

## Local checks

```sh
bash -n deploy/moderation/deploy.sh
node --test deploy/moderation/deployment.test.mjs
```

The tests only create temporary local package/configuration fixtures. They do not SSH, deploy, contact Firebase or provision credentials. Caddy/systemd and authenticated production IAM behavior still require checks on the actual VPS during the coordinating release.
