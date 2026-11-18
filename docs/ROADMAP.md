# Roadmap

## Phase 0: Sandbox prototype (mock connectors)
- [x] Prisma schema (invites, responses, cases, users, audit, settings)
- [x] Helix webhook creates expiring survey invites
- [x] Survey page and submit API (409 on repeat, 410 on expiry)
- [x] Unsatisfied answer creates a recovery case, pushed to BWF (mock)
- [x] BWF failure keeps the response; case FAILED, retry from Cases page
- [x] Login, RBAC, immediate revocation, audit log
- [x] Dashboard metrics, scoped for support groups
- [x] Cases queue and admin page (users, audit log)
- [x] Responses page: every survey with answer and comments (scoped; requester email Admin/Experience only)
- [ ] Responses: search, date filter and CSV export (export needs a PII decision first)
- [x] Unit tests (18) and one mutation check
- [ ] Browser walkthrough of every page while signed in (not yet done)
- [ ] Admin settings page and `/api/admin/settings` (`AppSetting` table exists, no UI or API)

## Phase 1: Live integration
- [x] Helix-sent link entry (`/survey?incident=&key=`) with Helix verification (mock + fake-server tests)
- [x] Live Helix connector built (tested against a fake Helix only)
- [x] Real Helix dev tenant: login, lookup, resolved and requester checks pass for one incident (key = Incident Number, ADR-012)
- [ ] Confirm `Assigned Group` and negative cases (wrong key, unresolved incident) against real Helix; get a random key field in Helix (#2)
- [ ] Rate limit the `/survey` entry (each click calls Helix)
- [ ] Decide on SSO or similar if the clicker must be proven to be the requester
- [ ] Live BWF connector (create case) (#2)
- [ ] HMAC-over-body plus timestamp on the webhook (ADR-007)
- [ ] PostgreSQL, migrations (replace `db push`) (ADR-003)
- [ ] Rate limiting on login and survey submit
- [ ] Send survey emails (currently links are only returned to Helix)
- [ ] Retention and export rules for requester email and comments (PII)

## Phase 2: Operate
- [ ] Deployment, monitoring, backups (see OPERATIONS.md)
- [ ] Add a CIO-specific `/cio` view (architecture mentions it; today CIO uses the dashboard)
