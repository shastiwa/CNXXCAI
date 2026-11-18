# Changelog

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
