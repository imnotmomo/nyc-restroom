# Own-domain VPS hosting

This records the initial VPS release. The later [Citywide import](citywide-import.md) expands the directory while retaining this hosting setup and signup storage.

## Brief and plan

The team supplied an empty VPS at `206.189.203.190` and the domain `nyc.imfinethanku.me`, and authorized SSH access. Host the existing Next.js web app over HTTPS while retaining Firebase Google accounts and Firestore. Keep public browsing and location permission behavior, preserve signup durability across updates, and prepare Apple MapKit JS for the token the team is creating.

Use Node.js 24 LTS and Caddy with a dedicated nonroot application service. Build locally; transfer only the self-contained public build and required Node/SQLite runtime files. Keep SQLite outside releases. Add the new hostname to the existing Firebase Google configuration. Retain the original Sites deployment and its database.

## Review and implementation

An independent runtime review found that the existing Node entry point reconstructed proxy requests as HTTP, which would reject legitimate HTTPS signups. `PUBLIC_ORIGIN` now validates and supplies the canonical origin without weakening the signup Origin check. Spoofed forwarded headers do not change it.

A separate read-only reviewer approved the integrated Node runtime, tests, Caddy configuration, and systemd restrictions. SQLite's state directory remains writable; application files are read-only to the service. The health endpoint reports process liveness only.

Deployment review also caught and fixed two rollback cases: an immediate service-start failure must enter rollback, and the first release must not treat an absent `current` symlink as a previous release. Startup rollback restores both the previous unit and application release when available.

## Verification and release

- Sixteen fast tests passed with Node.js 24, including actual local HTTP proxy requests with an HTTPS canonical origin and persisted temporary SQLite signups.
- TypeScript checking passed.
- Firebase Google auth configuration deployed successfully with the new hostname.
- Production build passed and packaged 71 public Next.js assets.
- Deployed release `20261016T005251Z-df3179e8a7f6` on October 15, 2026 (New York time). Its release record identifies source HEAD `df3179e8a7f62198fe6e20348f33f9b644e3e487` with local changes; it is not represented as an exact Git commit deployment.
- Both services are active and enabled at boot. Node listens only on `127.0.0.1:3000`, running as `restroom-ready`. Its database is mode `600`; deployed application files remain root-owned.
- Independent public verification confirmed a trusted hostname-matching TLS certificate, HTTP-to-HTTPS 308 redirect, all seven public pages returning 200, unknown paths returning 404, immutable Next.js asset caching, and uncached health GET/HEAD.
- Chrome verified the live 55-location finder, map pins, filters, 390px mobile list/map/details, the Google OAuth sign-in screen through the existing Firebase handler, and Locate me with granted synthetic coordinates outside collection bounds. No personal location or Google credentials were used.
- A real browser signup reached thank-you after a database save; its source/campaign fields were checked. The reserved test signup survived a service restart and was then removed. A foreign-Origin request returned 403 and stored nothing. SQLite integrity checking passed.
- Browser results: `docs/features/vps-browser-checks.json`. No uncaught browser errors were recorded.

## Remaining inputs

Apple Maps requires the team's domain-restricted MapKit JS web token, followed by a rebuild and an actual browser authorization/rendering check. A real Google account login and Firestore save/readback require the team's interactive Google sign-in; automated checks do not enter personal credentials. GA4 remains unconfigured until a measurement ID is supplied.
