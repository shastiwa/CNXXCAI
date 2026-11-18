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

## Phase 1a: Survey experience (v0.3.0)
- [x] 7 configurable dissatisfaction reasons
- [x] Optional comments and positive feedback
- [x] Attachments with admin-set limits and content checks
- [x] Request details on the survey page (needs real Helix field names)
- [x] Mobile-friendly survey page, thank-you page, configurable expiry
- [ ] Verify detail field names against real Helix
- [ ] Virus scanning for attachments
- [x] Phase 1b (v0.6.0): dashboard KPIs, trends, filters, group, agent, service and category analytics, heatmap, Excel export
- [ ] PDF export, scheduled reports (Phase 3)
- [ ] Check heatmap colours, dark mode and desktop Excel with a larger data set
- [ ] Response rate counts only surveys that exist; people who never clicked a Helix link are not counted (needs Helix to report links sent)

## Roles (v0.4.0)
- [x] Service Delivery Manager and Support Agent roles, central role rules, fail-closed scoping
- [x] Admin can change an existing user's role, group, agent name and active flag
- [ ] Create users and reset passwords from the Admin page (needs a password-delivery decision)
- [ ] Decide Service Delivery Manager access to follow-ups (with the Phase 2 Follow-up module)

## Phase 2a: Lifecycle and reminders (v0.5.0)
- [x] Statuses Pending, Sent, Viewed, Responded, Expired, Cancelled with history
- [x] Cancel and controlled reopen (reason, audit, limit)
- [x] Lifecycle job (expire, remind) with scheduler secret
- [ ] Reminder delivery (needs an email or Helix notification method; `REMINDER_MODE` is off)
- [ ] Browser check of the Surveys page and buttons
- [ ] Call the job from a real scheduler

## Phase 2b: Follow-ups (not started)
- [ ] Follow-up module, routing, escalation rules
- [ ] Sync responses back to Helix and create follow-up records (needs Helix write endpoints and field names)

## Phase 2: Operate
- [ ] Deployment, monitoring, backups (see OPERATIONS.md)
- [ ] Add a CIO-specific `/cio` view (architecture mentions it; today CIO uses the dashboard)
