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

## Helix webhook (sandbox, older flow)
`POST /api/webhooks/helix` with header `X-Helix-Signature` and JSON `{ "incidentId", "supportGroup", "requesterEmail" }`. Returns the survey links.

## Mock behaviour
An incident id containing `FAIL` makes the mock BWF fail, to test the retry path.

## Open blockers
- Live Helix and BWF endpoints, auth method and field mappings are unknown (#2).
- PostgreSQL is not installed locally.
- Data: use fake data only. Requester emails and comments are personal data.
