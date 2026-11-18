# Changelog

## 0.4.0 (roles)
- Added: two roles, **Service Delivery Manager** and **Support Agent**. The other four keep their enum names and get display names: Admin = System Administrator, Support Group = Support Group Manager, CIO = Read-only Management (ADR-016). Experience Team is unchanged.
- Added: `User.agentName` (one optional column). A Support Agent sees only surveys whose Helix assigned agent equals this text exactly.
- Added: `src/lib/roles.ts`, the one place for who may do what. Routes, pages and the menu use it, replacing scattered role checks.
- Changed (safer): data scoping now fails closed. A role with no rule, a group manager with no group, or an agent with no name sees nothing. Before, only SUPPORT_GROUP was scoped and any other role saw everything.
- Added: Admin page can change an existing user's role, group, agent name and active flag (`PUT /api/admin/users/[id]`), with a confirm step and audit log. An admin cannot edit themselves; the last active admin cannot be removed. Creating users and password reset are not built yet.
- Seed adds `sdm@example.test` and `agent@example.test` (agent name "Test Agent", matches the mock Helix agent). Running the seed resets passwords of all seeded users, as before.
- Tests: 103 total (21 new, including every role against every route). Ten deliberate breaks of the rules were all caught; one needed a better test first (blank agent name).
- Checked in the running app: sign in as each role; Agent sees only their survey, no email, no file access (403); SDM sees all, can open files, no cases or admin; non-admin edit refused (403); self-edit refused (400).
- Not verified: the Users table on the Admin page in a browser (only its HTML and the API were checked).
- Limits: an agent only sees surveys created after v0.3.0 and only if Helix returns an agent (older surveys have none). Agent name matching is exact text. Support Agents get no attachments, by choice (personal data); easy to change in `roles.ts`.

## 0.3.0 (Phase 1a: survey experience)
- Added: 7 dissatisfaction reasons, editable by an admin (Admin page). Removed reasons are turned off, not deleted. A reason must be on the list (ADR-013).
- Added: attachments on an Unsatisfied answer. Limits and allowed types are admin settings. Checks: count, size, extension, and file content must match the extension. Files are stored in `UPLOAD_DIR` under random names; staff download them through `/api/attachments/[id]` (group users: own group only; CIO: never) (ADR-014).
- Added: the survey page shows request details (ID, summary, service, group, resolution date) and a positive-feedback prompt on Satisfied. Mobile layout.
- Added: request details are read from Helix in a second, best-effort call, so a wrong field name can never break the survey link (ADR-015). Field names can be changed with `HELIX_DETAIL_FIELDS`.
- Added: admin settings (`/api/admin/settings`): link expiry days, file limits, show or hide the summary. Audit logged.
- Changed (additive DB only): `SurveyInvite` has 7 new optional columns; new tables `SurveyAttachment` and `SurveyReason`. Existing data kept; `db push` asked for no data loss.
- Changed: old reason wording ("Took too long" etc.) is no longer accepted on submit. Old responses keep their text. Three test files updated for this.
- Tests: 82 total (26 new). Mutation-checked: content check, size limit, orphan file cleanup, reason check, group scope on files, CIO block.
- Checked in the running app (mock mode): survey page, real PNG upload (201), `.exe` refused (400), second submit refused (409), download without login refused (401).
- Not verified: the Helix detail field names against real Helix (placeholders; ADR-011 list), the page in a real phone, a signed-in download in the browser, virus scanning of files (not built).
- Not done on purpose: files on a Satisfied answer; several reasons per answer; no-JavaScript form fallback.
- Risk to decide: the summary is Helix free text and the link key is the guessable Incident Number (ADR-012). Anyone who knows an incident number can read its summary. Turn it off in Admin if that is a concern.

## 0.2.1
- Verified against the real Helix dev tenant (REST host `solvnow-dev-restapi`, not the portal host): login, incident lookup, resolved status and requester check passed for one test incident, and a survey was created.
- Changed: link key is the Incident Number (ADR-012). Guessable, accepted by the user.
- Added: server log line when a Helix lookup fails (status code or network reason only).
- Lesson: the portal host returned 404 for `/api/jwt/login`; earlier "works" signs were mock-mode calls. Check latency and the log, not just the page.
- Not verified: `Assigned Group` value, a wrong-key and unresolved-incident check against real Helix, live BWF (still mock; keep `BWF_MODE=mock`).

## 0.2.0
- Added: Helix-sent survey link. `/survey?incident=&key=&r=` asks Helix (read-only) whether the incident exists, the key matches, it is resolved and has a requester, then creates one survey per incident (ADR-009, ADR-010).
- Added: live Helix REST connector (JWT login, token reuse, one re-login, https required, query-safe incident ids, error bodies never leaked). Tested against a fake Helix server only.
- Added: `IncidentLink` table (additive; existing data kept). Mock Helix demo ids (`INC-OPEN-…` etc.).
- Tests: 56 total. Mutation-checked: key check, resolved check, injection guard.
- Not verified: any real Helix. `HELIX_FIELDS` names are unverified defaults (ADR-011). BWF case creation is still mock. No rate limit on the new entry page.
- Not done on purpose: `--accept-data-loss` on the database; a unique column on `SurveyInvite`.

## 0.1.3
- Added: **Responses** page and `GET /api/responses`. Lists every survey with the answer, minutes lost, reason, call back choice, comments and linked case. Filter by Satisfied / Unsatisfied. Support groups see only their own group; requester email is shown only to Admin and Experience Team (PII). 5 tests, mutation-checked.
- Not verified: the page as a signed-in user in a browser (only signed-out redirect and API 401 were checked).

## 0.1.2
- Fixed: survey submit and the Helix webhook returned 500 "Internal error" for a non-JSON body (for example a form post when the page's JavaScript is blocked). They now return 400. Added `tests/api-body.test.ts` and confirmed it fails with the old behaviour.
- Changed: login and survey forms use `method="post"`, so credentials and comments never go into the URL or server logs if JavaScript fails.
- Known limit: with JavaScript blocked (for example by a browser extension) the forms still do not work. A no-JavaScript fallback is not built.
- Folder renamed from "Survey Manegment" to "Survey Management".

## 0.1.1
- Fixed: sign in always failed with "Invalid input". The form sends `next: null` when the URL has no `?next=`, and the login check rejected null. Why it was missed: earlier checks called the API without `next`. Added `tests/login.test.ts` (4 tests) and confirmed it fails with the bug.

## 0.1.0 (Phase 0 sandbox)
- Added survey invite webhook, survey page and submit API, with expiry and one-response-per-invite.
- Added closed-loop recovery cases with mock BWF, FAILED state and retry (ADR-004).
- Added login, role checks, immediate revocation, audit log (ADR-006).
- Added dashboard with group scoping, cases queue and admin page.
- Added 18 unit tests. Scoping test checked by breaking the fix and confirming failure.
- Docs: architecture, decisions, roadmap, operations.
- Not done on purpose: live connectors, email sending, rate limiting, PostgreSQL (see ROADMAP.md).
- Drift check: `docs/ARCHITECTURE.md` says "middleware"; Next.js 16 calls it `proxy` (`src/proxy.ts`). Updated.
