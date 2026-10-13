# Implementation validation

Validated locally on October 13, 2026.

- All seven Supabase migrations applied to a fresh disposable PostgreSQL 14 cluster.
- `npm run test:database`: **43 tests passed, zero failures or skips**, covering business isolation, manager permissions, managed-pilot access, enrollment expiry/reuse/throttling, concurrent duplicate punches, action sequencing, geofence checks, revocation, legacy import repeatability/conflicts, historical wage changes, approval invalidation, published schedule protection, atomic proposal rollback, access expiration, break calculations, overtime, DST, overnight weeks, missing wages, schedule generation, and safe CSV output.
- New attendance coverage includes stable publication snapshots during draft edits, early-punch plan protection, replacement schedules, planned breaks and coverage gaps, grace periods without rounding, ambiguous/multiple-session matches, review invalidation, cross-week attendance, forecasts, effective wage imports, and dual-product server authorization.
- Client portal and admin portal production builds passed. Client routes are split into separate bundles so employee clock users do not load the Pricing Assistant interface.
- Deno type check of `supabase/functions/time-clock/index.ts` passed.
- `npm run test:browser` passed using Google Chrome and an isolated local database: onboarding, employee creation, suggested draft, planned break editing, publication, QR rendering, phone enrollment, clock-in, attendance review, CSV download, settings, pricing import preview/confirmation, actual-import rejection for an incomplete week, expired Pricing Assistant import denial, and clearing an already-open planner on entitlement expiration. Desktop/mobile layout checks cover the overview, attendance comparison, employee clock, and pricing import.
- All ten public HTML pages loaded with the Reimage Tech name and no JavaScript page errors in the browser check. Desktop/mobile screenshots were inspected for the public website, manager overview, employee clock, admin login, and Pricing Assistant. The pricing editor overlap found during review was corrected.
- Root server and client entry-point syntax checks passed; folder rename verified.

Screenshots under `artifacts/` contain synthetic test data. Local test servers and the temporary development database were stopped after validation.

## Hosted rollout — October 13, 2026

- Public and admin sites deployed independently from their existing repositories. Client branding deployed first, preserving existing paid routes, followed by the integrated workforce release after backend validation.
- Production project `cjjaaajszmtmuqwglacb` was backed up (public, auth, and migration schemas), and the custom-format archive was verified before changes. All seven migrations passed a production transaction/rollback compatibility check and were then applied through the Supabase migration CLI.
- Two synthetic businesses passed production checks for bidirectional isolation, unauthorized writes, raw attendance read denial, managed-pilot trial denial, Pricing Assistant entitlement enforcement, one-use enrollment, invalid transitions, idempotent retries, revocation, and expired planner access. All synthetic records were rolled back. See `tests/production-smoke.sql`.
- The hosted `time-clock` Edge Function was deployed with the exact client origin allowlist. Live HTTP checks confirmed invalid/inactive links return 400 and disallowed origins return 403.
- Live client login/signup and signed-out redirects for both paid apps were checked. Public, client, and admin pages show the light Reimage Tech design. The user's existing Safari client tab was refreshed and verified.

Still required before onboarding a real pilot business: physical NFC/QR tests on iPhone and Android, including location permissions and network retry behavior. Automated tests and browser emulation do not certify hardware behavior. Operational destinations and authorization identities were preserved.
