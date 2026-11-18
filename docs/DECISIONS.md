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

## ADR-008: Test DB is a deleted-and-recreated file
`prisma db push --force-reset` is refused when run by an AI agent and is destructive. Tests delete `prisma/test.db` and run a plain `db push` instead.
