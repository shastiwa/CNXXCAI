# Operations

## Status
Local sandbox only. Nothing is deployed.

## Run locally
```bash
npm install
cp .env.example .env        # then set real random values (see .env.example)
npx prisma generate
npx prisma db push
npm run db:seed             # writes random passwords to .seed-credentials.txt (gitignored)
npm run dev
```
Note: this machine blocks npm install scripts, so run `npx prisma generate` yourself after `npm install`.

## Secrets (names only, never values)
| Name | Purpose | Where it lives |
|---|---|---|
| `SESSION_SECRET` | Signs login cookies (32+ chars) | `.env` locally |
| `HELIX_WEBHOOK_SECRET` | Shared secret Helix sends in `X-Helix-Signature` | `.env` locally; also set in the Helix webhook config |
| `DATABASE_URL` | Database connection | `.env` locally |
| Seed user passwords | Sandbox logins | `.seed-credentials.txt` locally (gitignored) |

## Helix-sent link (ADR-009)
Helix puts this in the email: `{APP_BASE_URL}/survey?incident=<Incident Number>&key=<unguessable ID>&r=SATISFIED` (and `r=UNSATISFIED`). `APP_BASE_URL` must be an address end users can reach (not localhost) before real use.

Mock Helix demo links (no secrets needed): `/survey?incident=INC-OK-1&key=key-INC-OK-1`. Change the id to test: `INC-OPEN-…` not resolved, `INC-MISSING-…` not found, `INC-NOREQ-…` no requester, `INC-HELIXDOWN-…` Helix down. Wrong `key` gives the generic "not valid" page.

Live Helix (`HELIX_MODE=live`) needs these names in `.env` (values never in the repo or chat): `HELIX_BASE_URL` (https), `HELIX_USERNAME`, `HELIX_PASSWORD` (read-only service account), optional `HELIX_TIMEOUT_MS`, `HELIX_RESOLVED_STATUSES`. Confirm `HELIX_FIELDS` with the Helix admin first.

## Attachments and survey settings (v0.3.0)
- `UPLOAD_DIR` (default `uploads`, gitignored): where files are stored. Must be a private folder on the server, backed up with the database, never served directly. Contains personal data.
- `HELIX_DETAIL_FIELDS` (optional JSON): renames Helix fields for request details, keys `summary, serviceName, requestType, category, priority, assignedAgent, resolvedAt`. Defaults are unverified.
- Admin page: link expiry (1-90 days), max files (0-10), max size (1-20 MB), allowed types, show summary, reasons. Env `SURVEY_EXPIRY_DAYS` is only the starting value until an admin saves.
- After pulling this version run `npx prisma generate` and `npx prisma db push` (adds columns and tables only).

## Roles and users (v0.4.0)
- After pulling: `npx prisma generate` and `npx prisma db push` (adds one column).
- Admin page: change a user's role, group (Support Group Manager) or agent name (Support Agent). Agent name must equal the Helix assigned-agent text exactly. Users cannot edit themselves; at least one active System Administrator must remain.
- New users and password resets are not built yet: add users through `prisma/seed.ts` for now. The seed resets the password of every seeded user and rewrites `.seed-credentials.txt`.
- Demo logins (sandbox only): `sdm@example.test`, `agent@example.test`; passwords are in `.seed-credentials.txt`.

## Lifecycle job and reminders (v0.5.0)
- After pulling: stop the dev server, then `npx prisma generate` and `npx prisma db push` (adds columns and one table only).
- Job: `POST /api/jobs/run` expires overdue surveys and sends reminders. Safe to run often (for example hourly). Admin page has a "Run now" button.
- Scheduler (for example Windows Task Scheduler): set `JOBS_SECRET` (16+ characters, name only here) in `.env`, then call the endpoint with header `X-Jobs-Secret`. Without `JOBS_SECRET` only a signed-in admin can run it.
- `REMINDER_MODE`: `off` (default) sends nothing. Reminders also need to be turned on in Admin settings. No live delivery exists yet, so even then the job only reports how many are due.
- Surveys: `/surveys` shows status and history. Admin and Experience Team can cancel or reopen (reason required).

## Dashboard and export (v0.6.0)
- After pulling: `npm install` (adds `exceljs`). No database change.
- Admin setting "minimum answers before a score is shown" (default 5) controls when scores appear.
- Excel download audit logs `dashboard.export` with the filters used (no data). The file holds counts, incident numbers, groups, services, categories, agent names and answers; no requester email, no comments. Treat the file as internal data once downloaded.
- Service, category, priority and agent come from Helix detail fields. If they show "(unknown)", set `HELIX_DETAIL_FIELDS` to the right field names.

## Helix webhook (sandbox, older flow)
`POST /api/webhooks/helix` with header `X-Helix-Signature` and JSON `{ "incidentId", "supportGroup", "requesterEmail" }`. Returns the survey links.

## Mock behaviour
An incident id containing `FAIL` makes the mock BWF fail, to test the retry path.

## Open blockers
- Live Helix and BWF endpoints, auth method and field mappings are unknown (#2).
- PostgreSQL is not installed locally.
- Data: use fake data only. Requester emails and comments are personal data.
