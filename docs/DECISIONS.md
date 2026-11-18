# Architecture Decision Records

## ADR-001: Single Next.js app (UI + API route handlers)
One deployable. Simpler than separate front end and API for Phase 0.

## ADR-002: Connector interfaces with mock and live adapters
Business logic depends on `HelixConnector` / `BwfConnector`. `HELIX_MODE` / `BWF_MODE` pick the adapter. Lets Phase 0 run with no Helix access.

## ADR-003: SQLite for local dev, PostgreSQL for deployment
Design target is PostgreSQL. PostgreSQL is not installed on the dev machine, so Phase 0 uses SQLite through Prisma 6. To switch: change `provider` and `DATABASE_URL` in `prisma/schema.prisma`, then `prisma db push`. Not yet tested on PostgreSQL.

## ADR-004: Persist the response before calling BWF
The survey response and a PENDING case are saved in one transaction. BWF is called afterwards. A BWF failure marks the case FAILED (retryable) and never fails the user's submission. Covered by `tests/survey.test.ts`.

## ADR-005: Cases are org-wide, not group-scoped
`/api/cases` and `/api/cases/[id]/retry` are role-gated (`ADMIN`, `EXPERIENCE_TEAM`) only. A central Experience Management Team owns all cases. Support groups see scoped dashboards only.

## ADR-006: Session revocation by re-reading the user
`getSession()` verifies the JWT and reloads the user from the DB. Deactivating a user or changing a role applies immediately, not at token expiry.

## ADR-007: Webhook uses a shared secret for now
`X-Helix-Signature` is compared in constant time to `HELIX_WEBHOOK_SECRET`. Weakness: a captured request can be replayed. Phase 1: HMAC over the body plus a timestamp.

## ADR-009: Helix sends the link; the app verifies it with Helix on click
Helix (not this app) emails the survey link. The link carries the incident number and an unguessable key. On click the app asks Helix, read-only, whether the incident exists, the key matches, the status is resolved, and a requester exists, then creates the survey. Why: matches the agreed flow where Helix owns the email; the app needs no email sending. Trade-offs: every click calls Helix (rate limiting is on the roadmap), and the link does not prove who is clicking. The webhook and token flow stays for now. Invalid reasons all give one generic message so incidents cannot be probed.

## ADR-010: One survey per incident via a separate IncidentLink table
`IncidentLink.incidentId` is the primary key, so two simultaneous clicks cannot create two surveys. A separate table was used because adding a unique column to the existing `SurveyInvite` table makes Prisma ask for `--accept-data-loss`, which was not used without the user's consent.

## ADR-011: Live Helix field names (partly verified)
`HELIX_FIELDS` in `src/connectors/live.ts` holds defaults for a standard Helix ITSM install. Against the dev tenant, the form, `Incident Number`, `Status` and `Internet E-mail` worked for one incident; `Assigned Group` is not confirmed. The REST host differs from the portal host (`-restapi`). The incident number is restricted to `[A-Za-z0-9_-]` before it goes into a Helix query.

## ADR-012: The link key is the Incident Number (user's decision)
`HELIX_FIELDS.accessKey` is `Incident Number`, so the link is `?incident=INC…&key=INC…`. Why: no separate key field exists in Helix. Risk: incident numbers are sequential and guessable, so anyone who knows a resolved incident number can open its survey and answer for the requester. Limits that remain: resolved-only, requester must exist, one survey per incident. Better later: a random key field in Helix, or SSO.

## ADR-013: Dissatisfaction reasons live in the database
`SurveyReason` holds the list (seven defaults, seeded on first use). Submit accepts only an active reason; "Other" is just another entry an admin may remove. Removed reasons are switched off, not deleted, so old responses keep their wording. One reason per answer for now.

## ADR-014: Attachments on disk, validated by content
Files go to `UPLOAD_DIR` (outside the web root) under random names; the database keeps the display name, type, size and SHA-256. The file type comes from the extension the admin allowed, and the first bytes must match it. The browser's content type is ignored. Downloads are always `attachment` with `nosniff`. Order: validate, write files, save to database, delete files if the save fails. Only Unsatisfied answers may carry files. Not built: virus scanning, so the file list is kept short and plain (no scripts, archives or programs). PDF and Office files can still carry hidden content: add scanning before real use.

## ADR-015: Request details are a separate, best-effort Helix call
The verified lookup (5 fields) is unchanged. Summary, service, type, category, priority, agent and resolved date are read in a second call that never throws; if it fails the survey still opens without details. Why: those field names are unverified, and a wrong name in the main query could have broken the one flow proven against real Helix. Names are set by `HELIX_DETAIL_FIELDS`.

## ADR-016: Six roles, rules in one file, scoping fails closed
Your suggested roles map onto the enum like this: System Administrator = `ADMIN`, Service Delivery Manager = `SERVICE_DELIVERY_MANAGER` (new), Support Group Manager = `SUPPORT_GROUP`, Support Agent = `SUPPORT_AGENT` (new), Read-only Management = `CIO`; `EXPERIENCE_TEAM` stays. Existing enum names were kept so no data changes; only labels differ (`ROLE_LABELS`).

| Role | Dashboard and responses | Requester email | Open files | Cases | Admin |
|---|---|---|---|---|---|
| System Administrator | all | yes | yes | yes | yes |
| Experience Team | all | yes | yes | yes | no |
| Service Delivery Manager | all | no | yes | no | no |
| Support Group Manager | own group | no | own group | no | no |
| Support Agent | surveys naming them | no | no | no | no |
| Read-only Management | all | no | no | no | no |

Why SDM has no cases: ADR-005 keeps cases with the central team; follow-up access for managers is decided with the Phase 2 Follow-up module. Why agents get no files: screenshots can hold personal data. Both are one-line changes in `src/lib/roles.ts`.
`buildScopeFilters` now fails closed: only roles explicitly marked "all" see everything. Agents are matched by exact Helix agent text (`User.agentName`); a wrong spelling shows nothing rather than too much.

## ADR-017: Survey statuses move through one checked function
Statuses: PENDING, SENT, VIEWED, RESPONDED, EXPIRED, CANCELLED. `moveStatus` (`src/services/lifecycle.ts`) is the only place that changes status. It checks a rule table, updates only if the status is still what it read, and writes the history row. Why: a cancel and an answer at the same moment cannot both win, and the answer is saved in the same transaction as its status move, so a survey cancelled after the page loaded refuses the answer. RESPONDED is final. EXPIRED and CANCELLED leave only through reopen. SENT is set only when the webhook hands the link to Helix; the app cannot know when an email was actually delivered. Trade-off: the status column has no database constraint on SQLite, so the rule table is the guard.

## ADR-018: Reopening keeps the old answer
`SurveyResponse.inviteId` is unique, and loosening it would need `--accept-data-loss`, so an answered survey is reopened by creating a new survey (`reopenedFromId`) and marking the old one `replacedById`. The old response is never edited or deleted. The incident's Helix link is moved to the new survey, so the requester uses the same email link. Dashboard counts use the latest survey per incident. Reopening needs a reason, is audit logged, is limited by the `maxReopens` setting, and is for System Administrator and Experience Team only. Expired and cancelled surveys have no answer, so they are reopened in place.

## ADR-019: Reminders are built, delivery is not
The job decides who is due (open, SENT or VIEWED, not expired, under the maximum, enough days since the last reminder) and claims each survey before sending so two job runs cannot double-send. The sending itself is behind `ReminderSender`. With `REMINDER_MODE=off` (default) nothing is sent or counted and the job result says so; there is no live sender because no email or Helix notification method is available. This avoids faking a successful external call. A failed send gives the slot back and is retried at the next run.

## ADR-020: Analytics are computed from rows, with a minimum and a safe export
`src/services/analytics.ts` reads the viewer's surveys (scope first, then filters, newest 20,000) and computes KPIs, trends, breakdowns and the heatmap in code. Why: SQLite has no date bucketing we can rely on across databases, and volumes are small. Move to database grouping if the cap is hit (the page warns). Rules: each incident counts once (replaced surveys are left out); a score under `minResponses` (default 5) is hidden; periods are UTC with Monday weeks and empty periods kept. Open surveys past their expiry count as expired even before the job marks them. The Excel export uses the same rows and scope, never includes requester email or comments, neutralises text that starts with `= + - @` in cells and headers (Helix text is untrusted), is audit logged, and is blocked for Support Agents (`ROLES_EXPORT`). Filters narrow the viewer's scope and cannot widen it. Why no comments in the export: free text can hold personal data and leaves the system once downloaded. Agent comparison inside a group is shown to group managers and above; agents never see each other.

## ADR-008: Test DB is a deleted-and-recreated file
`prisma db push --force-reset` is refused when run by an AI agent and is destructive. Tests delete `prisma/test.db` and run a plain `db push` instead.
